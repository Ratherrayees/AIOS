"use client";

import { AccountSecurityPanel } from "../../../components/account/account-security-panel";
import { SettingsNavigation } from "../../../components/ui/settings-navigation";
import "./security.css";

export default function SecuritySettingsPage() {
  return (
    <main className="security-page" id="main-content" tabIndex={-1}>
      <SettingsNavigation />
      <AccountSecurityPanel />
    </main>
  );
}
