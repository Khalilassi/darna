"use client";

import { RequirePermission } from "@/components/Shell";
import { VerificationQueue } from "@/components/VerificationQueue";

export default function VerificationsPage() {
  return (
    <RequirePermission permission="verification.review">
      <VerificationQueue />
    </RequirePermission>
  );
}
