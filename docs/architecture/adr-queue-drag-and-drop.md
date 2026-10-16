# ADR: precyzyjne miejsca upuszczenia i atomowy manual placement

Data: 2026-10-16. Status: zaakceptowane w zakresie zadania Enterprise DnD.

Pozostaje `@dnd-kit/core` 6.3.1. Registry `pnpm view` potwierdziło stabilne
`@dnd-kit/react` 0.5.1 (peers React/ReactDOM 18/19) i core 6.3.1 (>=16.8).
W projekcie React 19.2.6 i Next 16.3.0. Deklaracja peer nie zastępuje E2E.

| Wymiar | core | react |
| --- | --- | --- |
| Collision/layout | jawny detector, mierzone rects | nowy detector per droppable i priorytety |
| Listy/multi-container | istniejące integracje, jawny stan | nowe sortable API i helpers |
| Wejście | osobne Mouse/Touch/Keyboard sensors | unified pointer z constraints zależnymi od pointerType |
| Indicator | własny kontrakt slotów | również wymaga kontraktu aplikacji |
| Scroll/overlay/motion | wbudowany autoscroll i overlay | nowa warstwa DOM/plugins, overlay |
| A11y | własne polskie instrukcje i announcements | nowa integracja keyboard/feedback |
| Optimistic/CAS | odpowiedzialność aplikacji | odpowiedzialność aplikacji |
| Ryzyko/koszt | mniejszy zakres, znany runtime | wymiana provider/events/hooks/sensorów i testów |

[Oficjalna migracja](https://dndkit.com/react/guides/migration/) opisuje wymianę
provider, zdarzeń, hooków i sensorów. Oba warianty wymagają walidacji atomowości
po stronie aplikacji. Nie ma dowodu, że zmiana silnika poprawi tę domenę.
Nie instalujemy drugiego silnika ani nowych zależności.

Decyzja: pojedynczy model `QueuePlacement` (lane + indeks po usunięciu źródła).
Collision wybiera mierzoną strefę treści kolumny, następnie jej slot na podstawie
połówek kart o rzeczywistej wysokości. Ten sam slot renderuje indicator i trafia
do endpointu. Nagłówek, obszar poza kolumnami i viewportem nie są drop targets.
Brak fallbacku do najbliższego rogu poza strefą. Overlay nie wyznacza celu myszy.
Karty podczas gestu zachowują miejsce, więc przesunięcia layoutu nie zmieniają
połówek targetu. Scroll zmienia mierzone viewport rects, nie indeksy danych.

Tylko approved ma ręczną kolejność. Pending zachowuje czas zgłoszenia, rejected
czas zmiany; ich wskaźnik opisuje operację statusu, nie obiecuje ręcznego rankingu.
Now/history nie są draggable. Zwykła akceptacja nadal używa Fair Insert.
Jawny drop do approved ustawia wskazaną pozycję w tej samej transakcji co status.
Odrzucenie otwiera AlertDialog; cancel niczego nie zapisuje.

`expectedRevision` jest dokładnym wektorem id/version/status/position wszystkich
kart, bez PII i bez kolizji hasha. Backend porównuje go dopiero po istniejącym
event/session mutexie i kontroli RBAC/lifecycle. Stary gest dostaje 409, nigdy
automatycznego replay na nowej kolejce. Wszystkie admission/duplicate/2/2 guards,
renumber i audit należą do jednej transakcji. Bez migracji i zmiany Fair Queue.

Podczas drag zamrażamy snapshot. Invalidation pobiera dane; zmieniony canonical
revision odwołuje zamiar, a refetch z identycznymi wersjami zachowuje gest.
Odmontowana plansza i stara generacja nie mogą zapisać opóźnionego mouse-up.
Przy anulowaniu nie odmontowujemy aktywnego DndContext: wygaszamy podgląd
i auto-scroll, zachowując własność fizycznego sensora do up/cancel.
Spóźniony GET nie może nadpisać nowszego local generation. Podczas zapisu blokujemy
następny gest, pokazujemy dokładny optimistic placement; odpowiedź zawiera całą
kanoniczną kolejkę. Błąd usuwa projekcję i uruchamia refetch. Utracona odpowiedź
nie jest automatycznie ponawiana: stan rozstrzyga refetch i operator.

Mouse: uchwyt i 6 px. Touch: 250 ms, tolerance 8 px, scroll poza uchwytem.
Keyboard: sloty, przejścia między kolumnami, Escape, przywrócenie focusu;
przyciski góra/dół pozostają. Motion musi respektować reduced-motion.
