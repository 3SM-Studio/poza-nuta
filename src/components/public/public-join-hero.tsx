import Image from "next/image";

export function PublicJoinHero({
  eyebrow,
  title,
  titleId,
}: {
  eyebrow: string;
  title: string;
  titleId: string;
}) {
  return (
    <div className="grid min-h-[20rem] flex-1 content-center justify-items-center gap-2 px-6 py-[max(2rem,env(safe-area-inset-top))] text-center [@media(max-height:35rem)]:min-h-[15rem] [@media(max-height:35rem)]:py-4 sm:min-h-[22rem] sm:px-8 sm:py-[max(2.5rem,env(safe-area-inset-top))]">
      <Image
        alt="Poza Nutą"
        className="h-auto w-[min(12.5rem,42vw)] drop-shadow-[0_1rem_2rem_oklch(0_0_0_/_28%)] [@media(max-height:35rem)]:w-28 sm:w-[13.5rem]"
        height={1254}
        priority
        src="/brand/poza_nuta_logo-white.png"
        width={1254}
      />
      <p className="mt-3 text-sm font-bold tracking-[0.04em] uppercase">
        {eyebrow}
      </p>
      <h1
        className="w-full max-w-[22rem] text-[clamp(1.5rem,7vw,2.25rem)] font-extrabold leading-[1.08] tracking-[-0.045em] sm:max-w-[36rem] sm:text-[clamp(2.1rem,3.2vw,2.8rem)]"
        id={titleId}
      >
        {title}
      </h1>
    </div>
  );
}
