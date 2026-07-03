export const PUBLIC_SINGER_NAME_MAX_LENGTH = 80;
export const PUBLIC_NOTE_MAX_LENGTH = 300;
export const PUBLIC_SEARCH_MIN_LENGTH = 2;

export type PublicRequestFormInput = {
  songId: number | null;
  singerName: string;
  note: string;
};

export type PublicRequestFormErrors = Partial<
  Record<"songId" | "singerName" | "note", string>
>;

export type PublicRequestFormValidation =
  | {
      success: true;
      data: {
        songId: number;
        singerName: string;
        note: string | null;
      };
    }
  | {
      success: false;
      errors: PublicRequestFormErrors;
    };

export function validatePublicRequestForm(
  input: PublicRequestFormInput,
): PublicRequestFormValidation {
  const errors: PublicRequestFormErrors = {};
  const singerName = input.singerName.trim();
  const note = input.note.trim();

  if (
    input.songId === null ||
    !Number.isSafeInteger(input.songId) ||
    input.songId <= 0
  ) {
    errors.songId = "Wybierz piosenkę.";
  }

  if (!singerName) {
    errors.singerName = "Podaj imię lub ksywkę.";
  } else if (singerName.length > PUBLIC_SINGER_NAME_MAX_LENGTH) {
    errors.singerName = `Imię może mieć maksymalnie ${PUBLIC_SINGER_NAME_MAX_LENGTH} znaków.`;
  }

  if (note.length > PUBLIC_NOTE_MAX_LENGTH) {
    errors.note = `Notatka może mieć maksymalnie ${PUBLIC_NOTE_MAX_LENGTH} znaków.`;
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      songId: input.songId as number,
      singerName,
      note: note || null,
    },
  };
}

export function normalizePublicSearchTerm(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function canSearchPublicSongs(value: string) {
  return normalizePublicSearchTerm(value).length >= PUBLIC_SEARCH_MIN_LENGTH;
}

export function formatSongSource(source: "ising" | "karafun" | "manual") {
  const labels = {
    ising: "iSing",
    karafun: "KaraFun",
    manual: "Ręcznie",
  } as const;

  return labels[source];
}
