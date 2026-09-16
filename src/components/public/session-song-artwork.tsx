import { AudioLines, Disc3, MicVocal, Music4, Radio, Waves } from "lucide-react";

import { cn } from "@/lib/utils";

export type SongArtworkIdentity = {
  artist?: string | null;
  id?: number | string | null;
  source?: "ising" | "karafun" | "manual" | null;
  sourceSongId?: string | null;
  title?: string | null;
};

type ArtworkGlyph = "disc" | "mic" | "note" | "radio" | "sound" | "waves";

type SongArtworkRecipe = {
  glowClassName: string;
  glyph: ArtworkGlyph;
  id: string;
  markClassName: string;
  patternClassName: string;
  surfaceClassName: string;
};

const ARTWORK_RECIPES: readonly SongArtworkRecipe[] = [
  { id: "magenta-disc", surfaceClassName: "bg-[linear-gradient(145deg,#ec2f8d_0%,#8d2ab8_52%,#22164f_100%)]", patternClassName: "bg-[radial-gradient(circle_at_76%_22%,rgba(255,255,255,.3)_0_2%,transparent_2.6%),radial-gradient(circle_at_70%_18%,rgba(255,255,255,.2)_0_9%,transparent_9.5%)]", glowClassName: "bg-pink-200/35", markClassName: "border-pink-100/70", glyph: "disc" },
  { id: "violet-wave", surfaceClassName: "bg-[linear-gradient(135deg,#532bd3_0%,#9d36d5_50%,#e64b83_100%)]", patternClassName: "bg-[linear-gradient(128deg,transparent_0_39%,rgba(255,255,255,.16)_40%_42%,transparent_43%_100%)]", glowClassName: "bg-fuchsia-200/35", markClassName: "border-violet-100/70", glyph: "waves" },
  { id: "indigo-radio", surfaceClassName: "bg-[linear-gradient(155deg,#16326f_0%,#3056c9_48%,#a837cc_100%)]", patternClassName: "bg-[radial-gradient(circle_at_18%_82%,rgba(255,255,255,.22)_0_1.4%,transparent_1.8%)] [background-size:13px_13px]", glowClassName: "bg-blue-100/30", markClassName: "border-blue-100/65", glyph: "radio" },
  { id: "coral-mic", surfaceClassName: "bg-[linear-gradient(150deg,#f05a69_0%,#bd247e_47%,#3d176d_100%)]", patternClassName: "bg-[linear-gradient(45deg,transparent_0_45%,rgba(255,255,255,.13)_46%_49%,transparent_50%_100%)]", glowClassName: "bg-rose-100/35", markClassName: "border-rose-100/70", glyph: "mic" },
  { id: "electric-sound", surfaceClassName: "bg-[linear-gradient(145deg,#1374d4_0%,#6051df_49%,#b82fbc_100%)]", patternClassName: "bg-[radial-gradient(ellipse_at_8%_15%,rgba(255,255,255,.23)_0_3%,transparent_3.5%)]", glowClassName: "bg-cyan-100/35", markClassName: "border-cyan-100/70", glyph: "sound" },
  { id: "berry-note", surfaceClassName: "bg-[linear-gradient(140deg,#bd246e_0%,#812ca8_48%,#2d1c69_100%)]", patternClassName: "bg-[linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:18px_100%]", glowClassName: "bg-pink-100/30", markClassName: "border-fuchsia-100/70", glyph: "note" },
  { id: "night-disc", surfaceClassName: "bg-[linear-gradient(155deg,#142153_0%,#4233a7_50%,#bd3c9d_100%)]", patternClassName: "bg-[radial-gradient(circle_at_84%_82%,rgba(255,255,255,.22)_0_1.3%,transparent_1.8%)] [background-size:15px_15px]", glowClassName: "bg-violet-100/30", markClassName: "border-indigo-100/70", glyph: "disc" },
  { id: "plum-wave", surfaceClassName: "bg-[linear-gradient(150deg,#641d88_0%,#a132bd_45%,#ee5585_100%)]", patternClassName: "bg-[linear-gradient(155deg,transparent_0_52%,rgba(255,255,255,.16)_53%_55%,transparent_56%_100%)]", glowClassName: "bg-fuchsia-100/35", markClassName: "border-pink-100/70", glyph: "waves" },
  { id: "blue-mic", surfaceClassName: "bg-[linear-gradient(135deg,#174a92_0%,#236fc2_42%,#9e2db0_100%)]", patternClassName: "bg-[radial-gradient(circle_at_15%_18%,rgba(255,255,255,.22)_0_7%,transparent_7.5%)]", glowClassName: "bg-sky-100/35", markClassName: "border-sky-100/70", glyph: "mic" },
  { id: "pink-radio", surfaceClassName: "bg-[linear-gradient(145deg,#ec427f_0%,#ca318d_45%,#5830a1_100%)]", patternClassName: "bg-[linear-gradient(0deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:100%_14px]", glowClassName: "bg-rose-100/35", markClassName: "border-rose-100/70", glyph: "radio" },
  { id: "violet-sound", surfaceClassName: "bg-[linear-gradient(160deg,#372984_0%,#7043d2_45%,#e440b2_100%)]", patternClassName: "bg-[radial-gradient(circle_at_90%_12%,rgba(255,255,255,.26)_0_2%,transparent_2.5%)]", glowClassName: "bg-violet-100/30", markClassName: "border-violet-100/70", glyph: "sound" },
  { id: "deep-note", surfaceClassName: "bg-[linear-gradient(145deg,#17265d_0%,#4835a9_50%,#b62f98_100%)]", patternClassName: "bg-[linear-gradient(35deg,transparent_0_43%,rgba(255,255,255,.13)_44%_47%,transparent_48%_100%)]", glowClassName: "bg-indigo-100/30", markClassName: "border-blue-100/70", glyph: "note" },
  { id: "rose-disc", surfaceClassName: "bg-[linear-gradient(140deg,#dd386e_0%,#b227ad_47%,#4d277d_100%)]", patternClassName: "bg-[radial-gradient(circle_at_22%_74%,rgba(255,255,255,.21)_0_1.4%,transparent_1.9%)] [background-size:12px_12px]", glowClassName: "bg-pink-100/35", markClassName: "border-rose-100/70", glyph: "disc" },
  { id: "lilac-waves", surfaceClassName: "bg-[linear-gradient(150deg,#4232a0_0%,#8052cd_46%,#d841a4_100%)]", patternClassName: "bg-[linear-gradient(118deg,transparent_0_33%,rgba(255,255,255,.14)_34%_36%,transparent_37%_100%)]", glowClassName: "bg-purple-100/35", markClassName: "border-violet-100/70", glyph: "waves" },
  { id: "coral-sound", surfaceClassName: "bg-[linear-gradient(155deg,#e65369_0%,#c3318b_44%,#563091_100%)]", patternClassName: "bg-[radial-gradient(ellipse_at_84%_84%,rgba(255,255,255,.24)_0_5%,transparent_5.5%)]", glowClassName: "bg-orange-100/30", markClassName: "border-pink-100/70", glyph: "sound" },
  { id: "ultraviolet-radio", surfaceClassName: "bg-[linear-gradient(135deg,#233883_0%,#6250c5_46%,#d43a9d_100%)]", patternClassName: "bg-[linear-gradient(90deg,transparent_0_49%,rgba(255,255,255,.13)_50%_52%,transparent_53%_100%)]", glowClassName: "bg-blue-100/30", markClassName: "border-indigo-100/70", glyph: "radio" },
] as const;

const SOURCE_MARKS = {
  ising: "bg-cyan-100/90",
  karafun: "bg-pink-100/90",
  manual: "bg-violet-100/90",
  unknown: "bg-white/80",
} as const;

export function getSongArtworkSeed(song: SongArtworkIdentity): string {
  if (song.source && song.sourceSongId) return `${song.source}:${song.sourceSongId}`;

  return [song.source ?? "unknown", song.id ?? "", song.title ?? "", song.artist ?? ""]
    .map((part) => String(part).trim().normalize("NFC").toLocaleLowerCase("pl-PL"))
    .join("|");
}

export function getSongArtworkRecipe(song: SongArtworkIdentity): SongArtworkRecipe {
  return ARTWORK_RECIPES[stableStringHash(getSongArtworkSeed(song)) % ARTWORK_RECIPES.length]!;
}

export function SessionSongArtwork({ className, decorative = true, priority = false, song }: {
  className?: string;
  decorative?: boolean;
  priority?: boolean;
  song: SongArtworkIdentity;
}) {
  const recipe = getSongArtworkRecipe(song);
  const sourceMark = SOURCE_MARKS[song.source ?? "unknown"];

  return (
    <div
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : "Artwork utworu"}
      className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-xl text-white shadow-[0_8px_18px_rgba(10,7,35,.24)]", recipe.surfaceClassName, className)}
      data-artwork-recipe={recipe.id}
      data-artwork-priority={priority ? "high" : undefined}
      data-song-artwork="generated"
      role={decorative ? undefined : "img"}
    >
      <span aria-hidden="true" className={cn("absolute inset-0", recipe.patternClassName)} />
      <span aria-hidden="true" className={cn("absolute -top-1/4 -right-1/4 size-3/4 rounded-full blur-xl", recipe.glowClassName)} />
      <ArtworkGraphic glyph={recipe.glyph} />
      <span aria-hidden="true" className="relative grid size-[43%] place-items-center rounded-full border border-white/25 bg-black/10 text-[clamp(.62rem,3.3cqw,1.5rem)] font-black tracking-[-0.06em] text-white/95 shadow-[0_5px_14px_rgba(20,8,58,.18)]">
        {getArtworkMonogram(song.title)}
      </span>
      <span aria-hidden="true" className={cn("absolute right-[12%] bottom-[12%] size-[8%] min-h-1 min-w-1 rounded-full border", recipe.markClassName, sourceMark)} />
    </div>
  );
}

function ArtworkGraphic({ glyph }: { glyph: ArtworkGlyph }) {
  const className = "absolute left-[10%] top-[11%] size-[33%] text-white/80";
  const props = { "aria-hidden": true, className, strokeWidth: 1.5 };
  switch (glyph) {
    case "disc": return <Disc3 {...props} />;
    case "mic": return <MicVocal {...props} />;
    case "note": return <Music4 {...props} />;
    case "radio": return <Radio {...props} />;
    case "sound": return <AudioLines {...props} />;
    case "waves": return <Waves {...props} />;
  }
}

function getArtworkMonogram(title?: string | null) {
  const letters = (title ?? "").trim().match(/[\p{L}\p{N}]/gu) ?? [];
  return (letters[0] ?? "♪").toLocaleUpperCase("pl-PL");
}

function stableStringHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
