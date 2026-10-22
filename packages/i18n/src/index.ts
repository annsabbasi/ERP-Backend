import i18next, { type i18n, type Module } from 'i18next';
import en from './locales/en.json';
import ur from './locales/ur.json';

export const languages = ['en', 'ur'] as const;
export type Language = (typeof languages)[number];

export const resources = {
  en: { translation: en },
  ur: { translation: ur },
} as const;

export type CreateI18nOptions = {
  language?: Language;
  /** i18next plugins, for example initReactI18next from react-i18next. */
  plugins?: Module[];
};

/** Creates an i18next instance with the bundled translations, ready to use. */
export function createI18n({ language = 'en', plugins = [] }: CreateI18nOptions = {}): i18n {
  const instance = i18next.createInstance();
  for (const plugin of plugins) instance.use(plugin);
  void instance.init({
    resources,
    lng: language,
    fallbackLng: 'en',
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance;
}
