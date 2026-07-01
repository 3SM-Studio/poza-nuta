# iSing data access policy

## Cel

Celem importera jest utworzenie prywatnego indeksu dostepnosci piosenek karaoke dla Poza Nuty.

## Dozwolone dane

- song id
- title
- subtitle
- artist
- artist_id
- date_added
- duration
- genre
- plus
- hit
- buy
- permalink
- links.selflink

## Zakazane dane

- lyrics
- audio
- sample_url
- user recordings
- user profiles
- comments
- private account data
- premium-only data not visible publicly

## Zasady requestow

- `ISING_CLIENT_ID` pochodzi z publicznego requestu webowego iSing i nie jest traktowany jako prywatny sekret uzytkownika
- `ISING_CLIENT_ID` jest trzymany w env tylko dlatego, ze moze sie zmienic i nie powinien byc hardcodowany w kodzie
- importer domyslnie nie wymusza botowego User-Agenta
- jesli iSing poprosi o konkretny User-Agent albo identyfikacje, mozna ustawic `ISING_IMPORT_USER_AGENT`
- brak logowania
- brak obchodzenia premium/payment
- brak testow obciazeniowych
- brak agresywnego crawlowania
- brak wielu rownoleglych requestow
- brak live proxy; importer dziala tylko jako okresowy lokalny import metadanych
- importer zatrzymuje sie na 403, 429, HTML verification/challenge pages, nieoczekiwanych prywatnych danych oraz blednym ksztalcie response

## Zasady publicznej ekspozycji

Nie wolno wystawiac pelnej kopii bazy iSing publicznie. Publiczne UI moze kiedys pokazywac tylko ograniczone wyniki wyszukiwania potrzebne do requestu piosenki na evencie.
