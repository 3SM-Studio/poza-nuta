"use client";

import { useUiText } from "@/i18n/use-ui-text";

import Image from "next/image";
import Link from "next/link";

import styles from "./public.module.css";

export function PublicRequestPage() {
  const tx = useUiText();


  return (
    <main className={styles.publicPage}>
      <div className={styles.publicShell}>
        <header className={styles.publicHeader}>
          <Link
            className={styles.brand}
            href="/"
            aria-label={tx("Przejdź na stronę główną")}
          >
            <Image
              className={styles.brandLogo}
              src="/brand/poza_nuta_logo-white.png"
              alt="Poza Nutą"
              width={1254}
              height={1254}
            />
          </Link>
          </header>
          <h1>{tx("Zeskanuj KOD QR w barze.")}</h1>
      </div>
    </main>
  );
}
