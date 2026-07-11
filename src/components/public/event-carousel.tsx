"use client";

import useEmblaCarousel from "embla-carousel-react";
import { useCallback, useEffect, useState } from "react";

import type { PublicEventContract } from "@/lib/public-event-contract";

import styles from "./discovery.module.css";
import { PublicEventCard } from "./event-card";

type EventCarouselProps = {
  events: PublicEventContract[];
  title: string;
  description?: string;
};

export function EventCarousel({
  events,
  title,
  description,
}: EventCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false });
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const updateControls = useCallback(() => {
    setCanScrollPrev(Boolean(emblaApi?.canScrollPrev()));
    setCanScrollNext(Boolean(emblaApi?.canScrollNext()));
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) {
      return;
    }

    const frame = window.requestAnimationFrame(updateControls);
    emblaApi.on("select", updateControls);
    emblaApi.on("reInit", updateControls);

    return () => {
      window.cancelAnimationFrame(frame);
      emblaApi.off("select", updateControls);
      emblaApi.off("reInit", updateControls);
    };
  }, [emblaApi, updateControls]);

  if (events.length === 0) {
    return null;
  }

  return (
    <section aria-label={title}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        <div className={styles.carouselControls}>
          <button
            className={styles.iconButton}
            type="button"
            onClick={() => emblaApi?.scrollPrev()}
            disabled={!canScrollPrev}
            aria-label={`Poprzednie: ${title}`}
          >
            ←
          </button>
          <button
            className={styles.iconButton}
            type="button"
            onClick={() => emblaApi?.scrollNext()}
            disabled={!canScrollNext}
            aria-label={`Następne: ${title}`}
          >
            →
          </button>
        </div>
      </div>

      <div className={styles.carouselViewport} ref={emblaRef}>
        <div className={styles.carouselTrack}>
          {events.map((event) => (
            <div className={styles.carouselSlide} key={event.id}>
              <PublicEventCard event={event} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
