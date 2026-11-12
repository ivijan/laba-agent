# Studio Nova: persona, zasady i przykłady

Instrukcja używana przez aplikację znajduje się w `lib/studio-nova-prompt.ts` i jest przekazywana do modelu po stronie serwera. Określa rolę asystenta, znane fakty, ograniczenia, format odpowiedzi i dwa przykłady few-shot.

## Few-shot

**Klient:** Proszę o ofertę dla 8 osób.

**Asystent:**

Kategoria: sales

Szkic: Dziękuję za wiadomość. Czy chodzi o osiem indywidualnych konsultacji, czy o spotkanie grupowe? Po doprecyzowaniu przekażemy sprawę pracownikowi.

Do sprawdzenia: zakres i wycena oferty dla grupy; needs_review = true.

**Klient:** Nie mogę się zalogować.

**Asystent:**

Kategoria: support

Szkic: Napisz proszę, jaki komunikat pojawia się podczas logowania.

Do sprawdzenia: przyczyna problemu z logowaniem; needs_review = true.

## Porównanie instrukcji

Przykładowe wejście: „Czy mogę dostać rabat na konsultację?”

| Wariant | Przykładowa odpowiedź | Ocena wyniku |
|---|---|---|
| Bez instrukcji Studio Nova | „Tak, możemy zaproponować 20% rabatu.” | Niepoprawna: obiecuje rabat, którego zasad firma nie podała. To przykład odpowiedzi, którą należy odrzucić, a nie zapis wyniku wywołania modelu. |
| Z instrukcją Studio Nova | „Szkic odpowiedzi: Nie mamy dostępnych informacji o rabatach. Przekażemy pytanie pracownikowi.\nDo sprawdzenia: Czy można przyznać rabat.” | Poprawna: nie wymyśla warunków i wskazuje potrzebną decyzję. |

## Wynik bez i z krótkim objaśnieniem

To osobna próba obliczeniowa, nie część zasad cenowych firmy. Sprawdź obie odpowiedzi na tę samą podstawę: trzy konsultacje po 150 zł i zaliczka 100 zł.

- **Tylko wynik:** „350 zł”.
- **Wynik z krótkim, sprawdzalnym objaśnieniem:** „350 zł. 3 × 150 zł − 100 zł = 350 zł.”

Oba wyniki są poprawne; drugie objaśnienie pozwala sprawdzić rachunek. Długość uzasadnienia nie podnosi oceny sama w sobie. Oceniaj poprawność i to, czy wyjaśnienie pomaga zweryfikować odpowiedź. Nie wymagaj ujawniania pełnego wewnętrznego toku rozumowania.

## Zakres demonstracji

Porównanie zawiera przykładowe odpowiedzi do oceny, a nie wyniki rzeczywistych wywołań modelu. Model, ustawienia i losowość generowania mogą wpływać na odpowiedzi; przed oddaniem ćwiczenia można zapisać własne wyniki z aplikacji dla tej samej wiadomości i modelu.
