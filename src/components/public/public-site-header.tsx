
import { useUiText } from "@/i18n/use-ui-text";
import Image from "next/image";
import Link from "next/link";

import { ThemeSwitcher } from "@/components/theme-switcher";
import { LanguageSwitcher } from "@/components/language-switcher";

import styles from "./public-site-layout.module.css";

export function PublicSiteHeader() {
  const tx = useUiText();

  return (
    <header className={styles.siteHeader}>
      <div className={styles.siteHeaderInner}>
        <Link className={styles.logoLink} href="/" aria-label="Poza Nutą">
          <Image
            className={styles.logo}
            src="/brand/poza_nuta_logo-white.png"
            alt="Poza Nutą"
            width={1254}
            height={1254}
            loading="eager"
          />
        </Link>
        <nav className={styles.siteNav} aria-label={tx("Nawigacja publiczna")}>
          <Link href="/events">{tx("Wydarzenia")}</Link>
          <Link href="/dashboard">{tx("Panel organizatora")}</Link>
          <ThemeSwitcher />
          <LanguageSwitcher />
        </nav>
      </div>
    </header>
  );
}
