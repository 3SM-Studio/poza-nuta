// Small, dependency-free catalog: root-layout failures cannot rely on next-intl's
// provider, loaded UI catalogs, Auth or the database. Normal pages use its locale.
import type {Locale} from './locale';
export type RecoveryKind = 'unexpected'|'not_found'|'unauthorized'|'forbidden'|'rate_limited'|'unavailable'|'offline';
type Copy = {retry:string;join:string;signIn:string;dashboard:string;language:string;offlineNotice:string;states:Record<RecoveryKind,{title:string;description:string}>};
export const recoveryCopy:Record<Locale,Copy> = {
 pl:{retry:'Spróbuj ponownie',join:'Wpisz kod wydarzenia',signIn:'Zaloguj się',dashboard:'Wróć do dashboardu',language:'Język interfejsu',offlineNotice:'Brak internetu. Sprawdź połączenie. Jeśli masz niepotwierdzone operacje kolejki, pozostaw tę kartę otwartą.',states:{
  unexpected:{title:'Nie udało się otworzyć tej strony',description:'Wystąpił nieoczekiwany błąd. Spróbuj ponownie. Jeśli zarządzasz kolejką, sprawdź stan synchronizacji przed powtórzeniem akcji.'},
  not_found:{title:'Nie znaleźliśmy tej strony',description:'Adres może być niepełny lub nieaktualny. Aby dołączyć do karaoke, wpisz kod od organizatora.'},
  unauthorized:{title:'Zaloguj się ponownie',description:'Sesja logowania wygasła lub nie została rozpoczęta. Zaloguj się na to samo konto, aby wrócić do zachowanych operacji.'},
  forbidden:{title:'Nie masz dostępu do tego miejsca',description:'To konto nie ma wymaganych uprawnień. Wróć do dashboardu lub skontaktuj się z właścicielem organizacji.'},
  rate_limited:{title:'Zróbmy krótką przerwę',description:'Otrzymaliśmy zbyt wiele prób. Odczekaj chwilę i ponów operację ręcznie.'},
  unavailable:{title:'Chwilowa przerwa w działaniu',description:'Nie możemy teraz pobrać aktualnych danych. Spróbuj ponownie za chwilę; nie powtarzaj niepotwierdzonego zapisu bez sprawdzenia synchronizacji.'},
  offline:{title:'Brak połączenia z internetem',description:'Sprawdź Wi-Fi lub transmisję danych, a następnie spróbuj ponownie. Nie zamykaj karty z niepotwierdzonymi operacjami kolejki.'},
 }},
 en:{retry:'Try again',join:'Enter event code',signIn:'Sign in',dashboard:'Back to dashboard',language:'Interface language',offlineNotice:'You are offline. Check your connection. Keep this tab open if you have unconfirmed queue operations.',states:{
  unexpected:{title:'This page could not be opened',description:'An unexpected error occurred. Try again. If you manage a queue, check synchronization before repeating an action.'},
  not_found:{title:'We could not find this page',description:'The address may be incomplete or out of date. To join karaoke, enter the code provided by the organizer.'},
  unauthorized:{title:'Sign in again',description:'Your sign-in session expired or has not started. Use the same account to return to your saved operations.'},
  forbidden:{title:'You do not have access here',description:'This account does not have the required permissions. Return to the dashboard or contact the organization owner.'},
  rate_limited:{title:'Let’s take a short break',description:'We received too many attempts. Wait a moment, then retry the operation manually.'},
  unavailable:{title:'Temporarily unavailable',description:'We cannot retrieve current data right now. Try again shortly; check synchronization before repeating an unconfirmed write.'},
  offline:{title:'No internet connection',description:'Check Wi-Fi or mobile data, then try again. Keep any tab with unconfirmed queue operations open.'},
 }},
 uk:{retry:'Спробувати ще раз',join:'Ввести код події',signIn:'Увійти',dashboard:'Повернутися до панелі',language:'Мова інтерфейсу',offlineNotice:'Немає інтернету. Перевірте з’єднання. Не закривайте цю вкладку, якщо маєте непідтверджені дії в черзі.',states:{
  unexpected:{title:'Не вдалося відкрити цю сторінку',description:'Сталася неочікувана помилка. Спробуйте ще раз. Якщо ви керуєте чергою, перевірте синхронізацію, перш ніж повторювати дію.'},
  not_found:{title:'Сторінку не знайдено',description:'Адреса може бути неповною або застарілою. Щоб приєднатися до караоке, введіть код від організатора.'},
  unauthorized:{title:'Увійдіть ще раз',description:'Сеанс входу завершився або ще не розпочався. Увійдіть у той самий обліковий запис, щоб повернутися до збережених дій.'},
  forbidden:{title:'У вас немає доступу',description:'Цей обліковий запис не має потрібних дозволів. Поверніться до панелі або зверніться до власника організації.'},
  rate_limited:{title:'Зробімо коротку перерву',description:'Ми отримали забагато спроб. Зачекайте трохи, а потім повторіть дію вручну.'},
  unavailable:{title:'Тимчасово недоступно',description:'Зараз не вдається отримати актуальні дані. Спробуйте трохи пізніше; перевірте синхронізацію, перш ніж повторювати непідтверджений запис.'},
  offline:{title:'Немає з’єднання з інтернетом',description:'Перевірте Wi-Fi або мобільний інтернет і спробуйте ще раз. Не закривайте вкладку з непідтвердженими діями в черзі.'},
 }},
};
