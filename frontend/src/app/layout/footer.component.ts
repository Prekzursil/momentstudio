import { Component } from '@angular/core';

@Component({
  selector: 'app-footer',
  standalone: true,
  template: `
    <footer class="border-t border-slate-200 bg-white">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-600">
        <p class="font-medium text-slate-700">AdrianaArt</p>
        <p class="text-slate-500">Handcrafted ceramics · Since 2024</p>
        <div class="flex gap-4">
          <a class="hover:text-slate-900" href="#">Instagram</a>
          <a class="hover:text-slate-900" href="#">Pinterest</a>
          <a class="hover:text-slate-900" href="#">Contact</a>
        </div>
      </div>
    </footer>
  `
})
export class FooterComponent {}
