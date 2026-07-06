import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getDashboardNewOrganizationPath,
  getDashboardProfileOnboardingPath,
} from "@/lib/dashboard-routes";

import {
  OperatorProfileOnboardingForm,
  type OperatorProfileOnboardingState,
} from "../../../../components/operator/operator-profile-onboarding-form";
import styles from "../../../../components/operator/operator.module.css";
import { listDashboardOrganizationsForAuthUser } from "../../../../server/operator-api/organizations";
import {
  isOperatorProfileCompleted,
  requireOperatorSession,
  updateOperatorProfileForAuthUser,
} from "../../../../server/operator-api/supabase-session";
import { validateOperatorProfileInput } from "../../../../server/operator-api/validation";

export const metadata: Metadata = {
  title: "Profil | Poza Nutą",
};

export const dynamic = "force-dynamic";

export default async function DashboardProfileOnboardingPage() {
  const session = await requireOperatorSession("dashboard.onboarding.profile");
  const organizations = await listDashboardOrganizationsForAuthUser(
    session.authUser.id,
  );

  if (isOperatorProfileCompleted(session.operator) || organizations.length > 0) {
    redirect(organizations.length === 0 ? getDashboardNewOrganizationPath() : "/dashboard");
  }

  return (
    <main className={styles.queuePage}>
      <section className={styles.onboardingShell}>
        <Card className={styles.onboardingCard}>
          <CardHeader>
            <CardTitle>Przedstaw się</CardTitle>
            <CardDescription>
              Podaj dane, które będą widoczne w Twoim panelu i historii działań.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OperatorProfileOnboardingForm action={saveOperatorProfile} />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

async function saveOperatorProfile(
  _state: OperatorProfileOnboardingState,
  formData: FormData,
): Promise<OperatorProfileOnboardingState> {
  "use server";

  const validation = validateOperatorProfileInput({
    displayName: formData.get("displayName"),
  });

  if (!validation.success) {
    return {
      error: null,
      fieldErrors: Object.fromEntries(
        validation.issues.map((issue) => [issue.field, toProfileFieldMessage(issue.message)]),
      ),
    };
  }

  const session = await requireOperatorSession("dashboard.onboarding.profile");

  try {
    await updateOperatorProfileForAuthUser({
      authUserId: session.authUser.id,
      profile: validation.data,
    });
  } catch {
    return {
      error: "Nie udało się zapisać profilu. Spróbuj ponownie.",
      fieldErrors: {},
    };
  }

  revalidatePath("/dashboard", "layout");
  revalidatePath(getDashboardProfileOnboardingPath());

  const organizations = await listDashboardOrganizationsForAuthUser(
    session.authUser.id,
  );

  redirect(organizations.length === 0 ? getDashboardNewOrganizationPath() : "/dashboard");
}

function toProfileFieldMessage(message: string) {
  switch (message) {
    case "displayName is required.":
      return "Podaj imię i nazwisko.";
    case "displayName must contain at least 2 characters.":
      return "Imię i nazwisko musi mieć co najmniej 2 znaki.";
    case "displayName must contain at most 80 characters.":
      return "Imię i nazwisko może mieć maksymalnie 80 znaków.";
    default:
      return "Sprawdź wartość pola.";
  }
}
