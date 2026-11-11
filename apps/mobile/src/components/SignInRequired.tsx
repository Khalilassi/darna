import React from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthProvider";
import { EmptyState, LoadingState } from "./States";

/** Renders children only for signed-in users; otherwise a sign-in prompt. */
export function SignInRequired({ children, icon = "lock-closed-outline" }: { children: React.ReactNode; icon?: React.ComponentProps<typeof EmptyState>["icon"] }) {
  const { status } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  if (status === "loading") return <LoadingState />;
  if (status !== "signedIn")
    return (
      <EmptyState
        icon={icon}
        title={t("auth.signInPromptTitle")}
        body={t("auth.signInPromptBody")}
        actionLabel={t("common.signIn")}
        onAction={() => router.push("/login")}
      />
    );
  return <>{children}</>;
}
