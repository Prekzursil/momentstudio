import { Component } from '@angular/core';

@Component({
  selector: 'app-footer',
  standalone: true,
  template: `
    <footer class="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
        <p class="font-medium text-slate-700 dark:text-slate-100">AdrianaArt</p>
        <p class="text-slate-500 dark:text-slate-400">Handcrafted ceramics · Since 2024</p>
        <div class="flex gap-4">
          <a class="hover:text-slate-900 dark:hover:text-white" href="#">Instagram</a>
          <a class="hover:text-slate-900 dark:hover:text-white" href="#">Pinterest</a>
          <a class="hover:text-slate-900 dark:hover:text-white" href="#">Contact</a>
        </div>
      </div>
    </footer>
  `
})
export class FooterComponent {}
