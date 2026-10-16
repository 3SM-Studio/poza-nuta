# Slice 4: device linking i scalenie uczestnictwa wydarzenia

Decyzja: jeden dotychczasowy Participant Model. Bez łączenia po nicku,
IP lub user-agent. Bez globalnego przenoszenia uprawnień między organizacjami.

## Dowód i zakres

Device linking wystarcza, gdy kolejne urządzenie ma używać identity już
kontrolowanej przez zaufane urządzenie. Losowy token 256 bitów jest ważny
3 minuty, przechowywany jako SHA-256 i pokazywany wyłącznie w odpowiedzi POST.
Nie ma go w URL, QR URL, referrerze, analytics, broadcastach ani storage.
Drugie urządzenie wpisuje token, dostaje osobny HttpOnly challenge cookie
i kod porównania. Pierwsze urządzenie musi świadomie zatwierdzić ten kod.
Dopiero potem drugie potwierdza odbiór swojego credential. Przechwycenie samego
tokenu nie wystarcza do wydania credential. Claim/approve/finish są atomowe.
Retry tego samego potwierdzonego odbiorcy odtwarza ten sam credential z jego
losowego challenge i domain separation; w DB pozostaje tylko hash. Nie tworzy
następnych credentials. Inny odbiorca lub replay tokenu jest odrzucany.
Urządzenie już używające innej identity nie jest po cichu przełączane.

## Merge w jednym wydarzeniu

Gdy istnieją dwa uczestnictwa, operator wybiera source i target. Propozycja
pokazuje oba profile i historię. Właściciele obu muszą potwierdzić; dla osoby
ręcznie utworzonej bez jakiegokolwiek credential i bez publicznych requests
source proof zastępuje świadoma decyzja uprawnionego operatora. Target zawsze
wymaga aktywnego credential. Finalizacja ponownie wymaga operator RBAC,
ważnych consent credentials, aktywnego wydarzenia i niezmienionych nicków/ID.

Wybrano event-scoped merge zamiast globalnej zmiany participantIdentity:
- target eventParticipant jest kanoniczny w tym wydarzeniu;
- source identity i wszystkie credentials pozostają niezmienione globalnie;
- source eventParticipant pozostaje jako jednopoziomowy alias mergedIntoId;
- wszystkie source requests otrzymują target eventParticipantId, zachowując
  ID, daty, status, snapshot nicku, pozycję, źródło i operatora;
- stare aliasy są spłaszczane do target, bez cykli lub łańcuchów;
- członkostwa, historia i Presence innych wydarzeń pozostają nietknięte;
- source credential przez alias rozpoznaje target wyłącznie w tym evencie;
- nowe urządzenie otrzymuje credential identity urządzenia wystawiającego
  zaproszenie, a nie cudzej identity kanonicznego target. Zapobiega to eskalacji
  event alias do dostępu do innych wydarzeń target identity.

Alias nie tworzy równoległego systemu profili. Zachowuje stabilne rekordy
istniejącego modelu i jest odczytywany w jednym wspólnym resolverze membership.
Lista operatora pomija aliasy; odczyt starego ID prowadzi do kanonicznej historii.
Stare nicki aliasów pozostają zarezerwowane przez istniejący unique index.

## Transakcje i konflikty

Finalizacja: event lifecycle → istniejący session queue mutex → identity locks
w kolejności ID (NO KEY UPDATE, zgodne z FK) → wszystkie powiązane credentials
w kolejności ID → memberships w kolejności ID → proposal. Device credential
issuance używa identity SHARE przed credential SHARE. Presence nadal używa
credential SHARE i swoich advisory locks; merge czeka na zakończenie heartbeat
przed zmianą membership/connection. Rename nie bierze queue mutexu, ale kończy
się przed merge przez ten sam credential lock. Po oczekiwaniu resolver ponownie
czyta kanoniczne membership. Nie ma zewnętrznych wywołań pod lockami.

Pod mutexem ponownie liczymy pending/approved/now obu grup. Suma >2 lub aktywny
duplikat songId blokuje merge. Brak automatycznych odrzuceń/usuwania utworów.
Operator używa istniejących akcji kolejki i ponawia. Historyczne null FK
pozostają nietknięte. Brak zmian Fair Queue lub dat wykonań.

Presence connections source są przenoszone do target w tej samej transakcji,
z tym samym UUID, credential, heartbeat/expiry i tombstone. Agregacja sprawdza
event-scoped alias ownership. Opóźniony heartbeat rozpoznaje już target;
stary disconnect zamyka wyłącznie własny UUID. Broadcasty mają dotychczasowy
minimalny kontrakt; żadnych tokenów, nicków lub credentials.

## Audyt i odwracanie

Audyt techniczny invitation issue/claim/approve/consume i proposal/consent/merge
nie zawiera sekretów. Merge audit zachowuje source/target i ID przeniesionych
requests/connections oraz wcześniejsze aliasy. Nie ma hard-delete identity,
membership lub historii. Nie oferujemy automatycznego undo: późniejsze requesty
i zgody wymagają nowego planu forward-fix, przeglądu audytu i osobnej autoryzacji.
Migracja jest addytywna, deny-all RLS dla tokenów i proposals; docelowe wdrożenie
wymaga osobnej autoryzacji. PostgreSQL 17 pozostaje jedyną wersją testową.
