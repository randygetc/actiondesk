import { SecuritySection } from "@/components/security/security-section";
import { SettingsForm } from "@/components/settings-form";
import { mfaStatus } from "@/lib/auth/mfa";
import { requireUser } from "@/lib/auth/user";
import { TIME_ZONES } from "@/lib/validation/profile";

import { updateProfile } from "./actions";
import { confirmTotp, startTotp, turnOffTotp } from "./security-actions";

export default async function SettingsPage() {
  const { supabase, user } = await requireUser();
  const mfa = await mfaStatus(supabase);
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, timezone")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex max-w-md flex-col gap-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <SettingsForm
        action={updateProfile}
        zones={TIME_ZONES}
        displayName={profile?.display_name ?? ""}
        timezone={profile?.timezone ?? "America/Los_Angeles"}
      />
      <section aria-labelledby="security" className="flex flex-col gap-2">
        <h2 id="security" className="font-medium">
          Security
        </h2>
        <SecuritySection
          enabled={mfa.factorId !== null}
          start={startTotp}
          confirm={confirmTotp}
          turnOff={turnOffTotp}
        />
      </section>
    </div>
  );
}
