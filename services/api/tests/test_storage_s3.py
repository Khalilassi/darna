import io

import boto3
import pytest
from moto import mock_aws
from PIL import Image

from app.core import storage
from app.core.config import DEV_FERNET_KEY, Settings

BUCKET_PRIVATE, BUCKET_PUBLIC = "darna-private-test", "darna-public-test"


@pytest.fixture
def s3(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-central-1")
    with mock_aws():
        client = boto3.client("s3", region_name="eu-central-1")
        for b in (BUCKET_PRIVATE, BUCKET_PUBLIC):
            client.create_bucket(Bucket=b, CreateBucketConfiguration={"LocationConstraint": "eu-central-1"})
        yield client


def _jpeg_with_exif() -> bytes:
    buf = io.BytesIO()
    exif = Image.Exif()
    exif[0x010F] = "SecretCameraMaker"
    Image.new("RGB", (80, 60), (10, 120, 200)).save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


def test_private_documents_are_ciphertext_with_sse(s3):
    st = storage.S3EncryptedStorage(BUCKET_PRIVATE, DEV_FERNET_KEY, client=s3)
    secret = b"%PDF-1.4 SYNTHETIC-NATIONAL-ID-123"
    key = st.put(secret)
    obj = s3.get_object(Bucket=BUCKET_PRIVATE, Key=f"documents/{key}")
    raw = obj["Body"].read()
    assert b"SYNTHETIC-NATIONAL-ID" not in raw  # app-level encryption before upload
    assert obj["ServerSideEncryption"] == "AES256"
    assert st.get(key) == secret
    st.delete(key)
    assert s3.list_objects_v2(Bucket=BUCKET_PRIVATE).get("KeyCount", 0) == 0


def test_private_documents_use_kms_when_configured(s3):
    kms_key = boto3.client("kms", region_name="eu-central-1").create_key()["KeyMetadata"]["KeyId"]
    st = storage.S3EncryptedStorage(BUCKET_PRIVATE, DEV_FERNET_KEY, kms_key_id=kms_key, client=s3)
    key = st.put(b"%PDF data")
    head = s3.head_object(Bucket=BUCKET_PRIVATE, Key=f"documents/{key}")
    assert head["ServerSideEncryption"] == "aws:kms" and kms_key in head["SSEKMSKeyId"]


def test_public_photos_strip_metadata_and_build_cdn_urls(s3):
    st = storage.S3PublicMediaStorage(BUCKET_PUBLIC, "https://cdn.darna.example/", client=s3)
    key, w, h = st.put_image(_jpeg_with_exif())
    assert (w, h) == (80, 60)
    obj = s3.get_object(Bucket=BUCKET_PUBLIC, Key=f"media/{key}")
    assert obj["ContentType"] == "image/jpeg" and "immutable" in obj["CacheControl"]
    assert b"SecretCameraMaker" not in obj["Body"].read()
    assert st.url(key) == f"https://cdn.darna.example/media/{key}"
    st.delete(key)
    assert s3.list_objects_v2(Bucket=BUCKET_PUBLIC).get("KeyCount", 0) == 0


@pytest.mark.parametrize("bad", ["../etc/passwd", "a/b", "abc.exe", "", "ab cd"])
def test_storage_keys_are_validated(s3, bad):
    st = storage.S3EncryptedStorage(BUCKET_PRIVATE, DEV_FERNET_KEY, client=s3)
    with pytest.raises(ValueError):
        st.get(bad)


def test_s3_config_guards():
    with pytest.raises(RuntimeError, match="needs"):
        Settings(storage_backend="s3").validate_for_env()
    with pytest.raises(RuntimeError, match="different buckets"):
        Settings(storage_backend="s3", s3_private_bucket="same", s3_public_bucket="same", media_base_url="https://x").validate_for_env()
    with pytest.raises(RuntimeError, match="local' or 's3"):
        Settings(storage_backend="ftp").validate_for_env()
    Settings(storage_backend="s3", s3_private_bucket="p", s3_public_bucket="q", media_base_url="https://cdn").validate_for_env()


def test_api_document_and_photo_flow_on_s3_backend(s3, make_user, project, reviewer, client, monkeypatch):
    """End to end through the API with the S3 adapters swapped in."""
    from tests.conftest import publish_listing

    monkeypatch.setattr(storage, "_private", storage.S3EncryptedStorage(BUCKET_PRIVATE, DEV_FERNET_KEY, client=s3))
    monkeypatch.setattr(storage, "_public", storage.S3PublicMediaStorage(BUCKET_PUBLIC, "https://cdn.darna.example", client=s3))
    owner = make_user(verified=True)
    did = owner.upload_doc("national_id", b"%PDF-1.4 via-s3")
    url = owner.post(f"/documents/{did}/signed-url").json()["url"].replace("http://localhost:8000", "")
    assert client.get(url).content == b"%PDF-1.4 via-s3"
    lid = publish_listing(owner, reviewer, project)
    photo = client.get(f"/listings/{lid}").json()["photos"][0]["url"]
    assert photo.startswith("https://cdn.darna.example/media/")
    keys = [o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET_PUBLIC)["Contents"]]
    assert photo.rsplit("/", 2)[-2:] == keys[0].split("/")
