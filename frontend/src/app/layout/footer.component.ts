import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [TranslateModule],
  template: `
    <footer class="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
        <p class="font-medium text-slate-700 dark:text-slate-100">{{ 'app.name' | translate }}</p>
        <p class="text-slate-500 dark:text-slate-400">{{ 'footer.tagline' | translate }}</p>
        <div class="flex gap-4">
          <a class="hover:text-slate-900 dark:hover:text-white" href="#">{{ 'footer.instagram' | translate }}</a>
          <a class="hover:text-slate-900 dark:hover:text-white" href="#">{{ 'footer.facebook' | translate }}</a>
          <a class="hover:text-slate-900 dark:hover:text-white" href="#">{{ 'footer.contact' | translate }}</a>
        </div>
      </div>
    </footer>
  `
})
export class FooterComponent {}
