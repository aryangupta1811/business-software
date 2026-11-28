// An amount in words, the way an Indian invoice writes it (Indian numbering: thousand, lakh,
// crore). English also serves Hinglish: the design allows the English words there.
import type { BillLanguage, Paise } from '@business-software/shared';

const EN_UNDER_TWENTY =
  'Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen'.split(
    ' ',
  );
const EN_TENS = ['', '', ...'Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety'.split(' ')];

// Hindi has its own word for each of 0 to 99, so the table is the language.
const HI_UNDER_HUNDRED =
  'शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस इकतालीस बयालीस तैंतालीस चौवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उनासी अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानवे बानवे तिरानवे चौरानवे पंचानवे छियानवे सत्तानवे अट्ठानवे निन्यानवे'.split(
    ' ',
  );

interface Words {
  /** 1 to 99. */
  small: (n: number) => string;
  hundred: string;
  thousand: string;
  lakh: string;
  crore: string;
  zero: string;
}

const ENGLISH: Words = {
  small: (n) =>
    n < 20
      ? (EN_UNDER_TWENTY[n] ?? '')
      : `${EN_TENS[Math.floor(n / 10)] ?? ''}${n % 10 === 0 ? '' : ` ${EN_UNDER_TWENTY[n % 10] ?? ''}`}`,
  hundred: 'Hundred',
  thousand: 'Thousand',
  lakh: 'Lakh',
  crore: 'Crore',
  zero: 'Zero',
};

const HINDI: Words = {
  small: (n) => HI_UNDER_HUNDRED[n] ?? '',
  hundred: 'सौ',
  thousand: 'हज़ार',
  lakh: 'लाख',
  crore: 'करोड़',
  zero: 'शून्य',
};

/** 1 to 999. */
function hundreds(n: number, words: Words): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(words.small(Math.floor(n / 100)), words.hundred);
  if (n % 100 > 0) parts.push(words.small(n % 100));
  return parts.join(' ');
}

/** Any whole number from 1: crore, lakh, thousand, then the last three digits. */
function numberInWords(n: number, words: Words): string {
  const parts: string[] = [];
  const crores = Math.floor(n / 10_000_000);
  // More than 99 crore is "one hundred crore": the crore count is written like any number.
  if (crores > 0) parts.push(numberInWords(crores, words), words.crore);
  const lakhs = Math.floor(n / 100_000) % 100;
  if (lakhs > 0) parts.push(words.small(lakhs), words.lakh);
  const thousands = Math.floor(n / 1_000) % 100;
  if (thousands > 0) parts.push(words.small(thousands), words.thousand);
  if (n % 1_000 > 0) parts.push(hundreds(n % 1_000, words));
  return parts.join(' ');
}

/**
 * `12345` paise is "Rupees One Hundred Twenty Three and Forty Five Paise Only"; in Hindi,
 * "एक सौ तेईस रुपये और पैंतालीस पैसे मात्र". Throws a RangeError for anything that is not a
 * whole number of paise, 0 or more.
 */
export function amountInWords(paise: Paise, language: BillLanguage): string {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new RangeError(`Not an amount in paise: ${String(paise)}`);
  }
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  const hindi = language === 'hi';
  const words = hindi ? HINDI : ENGLISH;

  const rupeeName = rupees === 1 ? 'रुपया' : 'रुपये';
  const paiseName = hindi ? (rest === 1 ? 'पैसा' : 'पैसे') : rest === 1 ? 'Paisa' : 'Paise';
  const only = hindi ? 'मात्र' : 'Only';
  const and = hindi ? 'और' : 'and';

  const paisePart = rest === 0 ? [] : [words.small(rest), paiseName];
  // Under a rupee the paise stand alone: "Fifty Paise Only".
  if (rupees === 0 && rest > 0) return [...paisePart, only].join(' ');

  const amount = rupees === 0 ? words.zero : numberInWords(rupees, words);
  return [
    ...(hindi ? [amount, rupeeName] : ['Rupees', amount]),
    ...(rest === 0 ? [] : [and, ...paisePart]),
    only,
  ].join(' ');
}
