import Image from "next/image";
import Link from "next/link";

import { ThemeSwitcher } from "@/components/theme-switcher";

import styles from "./public-site-layout.module.css";

export function PublicSiteHeader() {
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
        <nav className={styles.siteNav} aria-label="Nawigacja publiczna">
          <Link href="/events">Wydarzenia</Link>
          <Link href="/dashboard">Panel organizatora</Link>
          <ThemeSwitcher />
        </nav>
      </div>
    </header>
  );
}
