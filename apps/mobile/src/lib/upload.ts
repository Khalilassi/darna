import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import type { Schemas } from "@darna/api-client";
import { api, unwrap } from "../api/client";

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  /** Present on web: the browser File object. */
  file?: Blob;
}

export async function pickImage(): Promise<PickedFile | null> {
  if (Platform.OS !== "web") {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return null;
  }
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsMultipleSelection: false });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  return {
    uri: a.uri,
    name: a.fileName ?? `photo-${Date.now()}.jpg`,
    mimeType: a.mimeType ?? "image/jpeg",
    file: a.file,
  };
}

export async function pickDocument(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.name, mimeType: a.mimeType ?? "application/octet-stream", file: a.file };
}

/** Builds a multipart part: a Blob on web, React Native's `{ uri, name, type }` descriptor on native. */
async function filePart(f: PickedFile): Promise<Blob> {
  if (Platform.OS === "web") return f.file ?? (await (await fetch(f.uri)).blob());
  return { uri: f.uri, name: f.name, type: f.mimeType } as unknown as Blob;
}

async function formWith(f: PickedFile, extra: Record<string, string> = {}): Promise<FormData> {
  const fd = new FormData();
  const part = await filePart(f);
  if (Platform.OS === "web") fd.append("file", part, f.name);
  else fd.append("file", part);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
}

// openapi-fetch passes FormData bodies through untouched; the generated types describe the parts as strings.
type MultipartBody<T> = T;

export async function uploadDocument(f: PickedFile, kind: Schemas["DocumentKind"]): Promise<Schemas["DocumentOut"]> {
  const body = (await formWith(f, { kind })) as unknown as MultipartBody<Schemas["Body_upload_documents_post"]>;
  return unwrap(await api.POST("/documents", { body, bodySerializer: (b) => b as unknown as FormData }));
}

export async function uploadListingPhoto(listingId: string, f: PickedFile): Promise<Schemas["PhotoOut"]> {
  const body = (await formWith(f)) as unknown as MultipartBody<Schemas["Body_upload_photo_listings__listing_id__photos_post"]>;
  return unwrap(
    await api.POST("/listings/{listing_id}/photos", {
      params: { path: { listing_id: listingId } },
      body,
      bodySerializer: (b) => b as unknown as FormData,
    }),
  );
}
