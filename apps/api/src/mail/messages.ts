// The emails the app sends (Module 00 #30, #32, #42). The API doesn't know the reader's
// language, so each email says everything in English and then in Hindi (ADR 0040).
import type { MailMessage } from './mailer.js';

/** Module 00 #32: sent after signup and on "Send again"; the link works for 7 days. */
export function confirmEmailMessage(to: string, link: string): MailMessage {
  return {
    to,
    subject: 'Confirm your email / अपना ईमेल पक्का करें',
    text: [
      'Open this link to confirm your email. Then you can reset your password by email if you forget it.',
      link,
      'The link works for 7 days.',
      '',
      'अपना ईमेल पक्का करने के लिए यह लिंक खोलें। इसके बाद पासवर्ड भूलने पर आप ईमेल से नया पासवर्ड बना सकेंगे।',
      link,
      'यह लिंक 7 दिन तक चलेगा।',
      '',
      "If you didn't sign up, ignore this email. / अगर आपने साइन अप नहीं किया, तो इस ईमेल को अनदेखा करें।",
    ].join('\n'),
  };
}

/** Module 00 #30: only to a confirmed owner email; the link works for 30 minutes, once. */
export function resetPasswordMessage(to: string, link: string): MailMessage {
  return {
    to,
    subject: 'Reset your password / अपना पासवर्ड बदलें',
    text: [
      'Open this link to choose a new password.',
      link,
      'The link works for 30 minutes, once.',
      '',
      'नया पासवर्ड चुनने के लिए यह लिंक खोलें।',
      link,
      'यह लिंक 30 मिनट तक, एक बार चलेगा।',
      '',
      "If you didn't ask for this, ignore this email: your password stays the same. / अगर आपने यह नहीं माँगा, तो इस ईमेल को अनदेखा करें: आपका पासवर्ड नहीं बदलेगा।",
    ].join('\n'),
  };
}
