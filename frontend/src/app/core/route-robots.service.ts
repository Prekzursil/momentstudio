import { Injectable, OnDestroy } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { Meta } from '@angular/platform-browser';
import { Subscription, filter } from 'rxjs';

const DEFAULT_ROBOTS = 'index,follow,max-image-preview:large';

@Injectable({ providedIn: 'root' })
export class RouteRobotsService implements OnDestroy {
  private navSub?: Subscription;
  private started = false;

  constructor(
    private readonly router: Router,
    private readonly meta: Meta
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.applyCurrent();
    this.navSub = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => this.applyCurrent());
  }

  ngOnDestroy(): void {
    this.navSub?.unsubscribe();
  }

  private applyCurrent(): void {
    const policy = this.resolvePolicy(this.router.routerState.snapshot.root);
    this.meta.updateTag({ name: 'robots', content: policy });
  }

  private resolvePolicy(root: ActivatedRouteSnapshot): string {
    let node: ActivatedRouteSnapshot | null = root;
    let policy = '';
    while (node) {
      const candidate = typeof node.data?.['robots'] === 'string' ? String(node.data['robots']).trim() : '';
      if (candidate) policy = candidate;
      node = node.firstChild ?? null;
    }
    return policy || DEFAULT_ROBOTS;
  }
}

