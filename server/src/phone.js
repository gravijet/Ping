import { config } from './config.js';

// Lightweight phone-number normalisation to a canonical E.164-ish string
// (`+` followed by 7-15 digits). We deliberately avoid a heavyweight
// libphonenumber dependency: the rules below cover the common ways people type
// a number and fall back to a configurable default country code.
//
//   "+49 170 1234567"  -> "+491701234567"
//   "0049 170 1234567" -> "+491701234567"
//   "0170 / 123 45 67" -> "+491701234567"   (default CC = 49)
//   "1701234567"       -> "+491701234567"   (default CC = 49)
export function normalizePhone(input, defaultCc = config.defaultCountryCode) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;

  // Keep a leading +, throw away everything that isn't a digit.
  const hasPlus = s.startsWith('+');
  let digits = s.replace(/\D/g, '');
  if (!digits) return null;

  if (hasPlus) {
    // Already international.
  } else if (digits.startsWith('00')) {
    // 00 is the international call prefix in much of the world.
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    // National trunk prefix: drop the 0 and prepend the default country code.
    digits = defaultCc + digits.replace(/^0+/, '');
  } else {
    // Bare local/mobile number — assume the default country.
    digits = defaultCc + digits;
  }

  if (digits.length < 7 || digits.length > 15) return null;
  if (digits.startsWith('0')) return null; // a valid E.164 CC never starts with 0
  return `+${digits}`;
}

// True if the value normalises to a plausible phone number.
export function isValidPhone(input) {
  return normalizePhone(input) !== null;
}
