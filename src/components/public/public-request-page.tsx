"use client";

import Image from "next/image";
import Link from "next/link";

import styles from "./public.module.css";

export function PublicRequestPage() {

  return (
    <main className={styles.publicPage}>
      <div className={styles.publicShell}>
        <header className={styles.publicHeader}>
          <Link
            className={styles.brand}
            href="/"
            aria-label="Przejdź na stronę główną"
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
          <h1>Zeskanuj KOD QR w barze.</h1>
      </div>
    </main>
  );
}
