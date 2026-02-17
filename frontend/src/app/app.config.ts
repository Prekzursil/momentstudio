import { APP_INITIALIZER, ApplicationConfig, importProvidersFrom, inject, isDevMode } from '@angular/core';
import { provideRouter, TitleStrategy, withComponentInputBinding } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { authAndErrorInterceptor } from './core/http.interceptor';
import { MissingTranslationHandler, TranslateModule } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { AdminClientErrorLoggerService } from './core/admin-client-error-logger.service';
import { provideServiceWorker } from '@angular/service-worker';
import { appConfig as runtimeConfig } from './core/app-config';
import { TranslatedTitleStrategy } from './core/translated-title.strategy';
import { AppMissingTranslationHandler } from './core/missing-translation.handler';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    provideAnimations(),
    provideHttpClient(withInterceptors([authAndErrorInterceptor])),
    { provide: TitleStrategy, useClass: TranslatedTitleStrategy },
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode() && runtimeConfig.appEnv === 'production',
      registrationStrategy: 'registerWhenStable:30000',
    }),
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: () => {
        const logger = inject(AdminClientErrorLoggerService);
        return () => logger.init();
      }
    },
    importProvidersFrom(
      TranslateModule.forRoot({
        fallbackLang: 'en',
        missingTranslationHandler: {
          provide: MissingTranslationHandler,
          useClass: AppMissingTranslationHandler
        }
      })
    ),
    ...provideTranslateHttpLoader({
      prefix: '/assets/i18n/',
      suffix: '.json',
    }), provideClientHydration(withEventReplay()),
  ]
};
