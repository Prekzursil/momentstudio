import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { from, of } from 'rxjs';
import { catchError, concatMap, finalize, map, mergeMap, toArray } from 'rxjs/operators';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { extractRequestId } from '../../../shared/http-error';
import { InputComponent } from '../../../shared/input.component';
import { HelpPanelComponent } from '../../../shared/help-panel.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { ActionBarComponent } from '../../../shared/action-bar.component';
import { FormSectionComponent } from '../../../shared/form-section.component';
import { ToastService } from '../../../core/toast.service';
import { LocalizedCurrencyPipe } from '../../../shared/localized-currency.pipe';
import { AdminOrderListItem, AdminOrderListResponse, AdminOrderTagStat, AdminOrdersService } from '../../../core/admin-orders.service';
import { orderStatusChipClass } from '../../../shared/order-status';
import { AuthService } from '../../../core/auth.service';
import { AdminFavoriteItem, AdminFavoritesService } from '../../../core/admin-favorites.service';
import {
  AdminTableLayoutV1,
  adminTableCellPaddingClass,
  adminTableLayoutStorageKey,
  defaultAdminTableLayout,
  loadAdminTableLayout,
  saveAdminTableLayout,
  visibleAdminTableColumnIds
} from '../shared/admin-table-layout';
import { AdminTableLayoutColumnDef, TableLayoutModalComponent } from '../shared/table-layout-modal.component';
import { AdminPageHeaderComponent } from '../shared/admin-page-header.component';
import { adminFilterFavoriteKey } from '../shared/admin-filter-favorites';

import {
  TagColor,
  TAG_COLOR_PALETTE,
  normalizeTagKey,
  loadTagColorOverrides,
  persistTagColorOverrides,
  tagColorFor,
  tagChipColorClass as tagChipColorClassFromHelper
} from './order-tag-colors';

type OrderStatusFilter =
  | 'all'
  | 'sales'
  | 'pending'
  | 'pending_payment'
  | 'pending_acceptance'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

type SlaFilter = 'all' | 'any_overdue' | 'accept_overdue' | 'ship_overdue';
type FraudFilter = 'all' | 'queue' | 'flagged' | 'approved' | 'denied';

type AdminOrdersViewMode = 'table' | 'kanban';
type KanbanStatus = Exclude<OrderStatusFilter, 'all' | 'sales' | 'pending'>;

type AdminOrdersFilterPreset = {
  id: string;
  name: string;
  createdAt: string;
  filters: {
    q: string;
    status: OrderStatusFilter;
    sla: SlaFilter;
    fraud: FraudFilter;
    tag: string;
    fromDate: string;
    toDate: string;
    includeTestOrders: boolean;
    limit: number;
  };
};

type AdminOrdersExportTemplate = {
  id: string;
  name: string;
  createdAt: string;
  columns: string[];
};

type ShippingLabelsUploadStatus = 'pending' | 'uploading' | 'success' | 'error';

type ShippingLabelsUploadItem = {
  file: File;
  assignedOrderId: string | null;
  status: ShippingLabelsUploadStatus;
  error?: string | null;
};

type ShippingLabelsOrderOption = {
  id: string;
  ref: string;
  shortId: string;
  label: string;
};

const ORDERS_TABLE_COLUMNS: AdminTableLayoutColumnDef[] = [
  { id: 'select', labelKey: 'adminUi.orders.table.select', required: true },
  { id: 'reference', labelKey: 'adminUi.orders.table.reference', required: true },
  { id: 'customer', labelKey: 'adminUi.orders.table.customer' },
  { id: 'status', labelKey: 'adminUi.orders.table.status' },
  { id: 'tags', labelKey: 'adminUi.orders.table.tags' },
  { id: 'total', labelKey: 'adminUi.orders.table.total' },
  { id: 'created', labelKey: 'adminUi.orders.table.created' },
  { id: 'actions', labelKey: 'adminUi.orders.table.actions', required: true }
];

const defaultOrdersTableLayout = (): AdminTableLayoutV1 => ({
  ...defaultAdminTableLayout(ORDERS_TABLE_COLUMNS),
  hidden: ['tags']
});

const PRESET_SLA_FILTERS = new Set<SlaFilter>(['any_overdue', 'accept_overdue', 'ship_overdue']);
const PRESET_FRAUD_FILTERS = new Set<FraudFilter>(['queue', 'flagged', 'approved', 'denied']);

  @Component({
    selector: 'app-admin-orders',
    standalone: true,
		  imports: [
		    CommonModule,
		    FormsModule,
        DragDropModule,
		    ScrollingModule,
		    TranslateModule,
		    BreadcrumbComponent,
		    ButtonComponent,
		    ErrorStateComponent,
	    InputComponent,
	    HelpPanelComponent,
	    SkeletonComponent,
      ActionBarComponent,
      FormSectionComponent,
	    LocalizedCurrencyPipe,
	    TableLayoutModalComponent,
      AdminPageHeaderComponent
	  ],
    templateUrl: './admin-orders.component.html',})
export class AdminOrdersComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin/dashboard' },
    { label: 'adminUi.orders.title' }
  ];

  readonly orderRowHeight = 44;
  readonly tableColumns = ORDERS_TABLE_COLUMNS;
  readonly tableDefaults = defaultOrdersTableLayout();

  layoutModalOpen = signal(false);
  tableLayout = signal<AdminTableLayoutV1>(defaultOrdersTableLayout());

  loading = signal(true);
  error = signal<string | null>(null);
  errorRequestId = signal<string | null>(null);
  orders = signal<AdminOrderListItem[]>([]);
  meta = signal<AdminOrderListResponse['meta'] | null>(null);

  viewMode = signal<AdminOrdersViewMode>('table');
  kanbanBusy = signal(false);
  kanbanItemsByStatus = signal<Record<string, AdminOrderListItem[]>>({});
  kanbanTotalsByStatus = signal<Record<string, number>>({});

  q = '';
  status: OrderStatusFilter = 'all';
  sla: SlaFilter = 'all';
  fraud: FraudFilter = 'all';
  tag = '';
  fromDate = '';
  toDate = '';
  includeTestOrders = true;
  page = 1;
  limit = 20;

  presets: AdminOrdersFilterPreset[] = [];
  selectedPresetId = '';
  selectedSavedViewKey = '';
  tagOptions = signal<string[]>(['vip', 'fraud_risk', 'fraud_approved', 'fraud_denied', 'gift']);

  exportModalOpen = signal(false);
  exportTemplates: AdminOrdersExportTemplate[] = [];
  selectedExportTemplateId = '';
  exportColumns: Record<string, boolean> = {};
  exportColumnOptions: string[] = [
    'id',
    'reference_code',
    'status',
    'customer_email',
    'customer_name',
    'total_amount',
    'currency',
    'tax_amount',
    'shipping_amount',
    'fee_amount',
    'payment_method',
    'promo_code',
    'courier',
    'delivery_type',
    'tracking_number',
    'tracking_url',
    'shipping_method',
    'invoice_company',
    'invoice_vat_id',
    'locker_name',
    'locker_address',
    'user_id',
    'created_at',
    'updated_at'
  ];

  selectedIds = new Set<string>();
  bulkStatus: '' | Exclude<OrderStatusFilter, 'all'> = '';
  bulkCourier: '' | 'sameday' | 'fan_courier' | 'clear' = '';
  bulkEmailKind: '' | 'confirmation' | 'delivery' = '';
  bulkTagAdd = '';
  bulkTagRemove = '';
  bulkBusy = false;

  shippingLabelsModalOpen = signal(false);
  shippingLabelsOrderOptions: ShippingLabelsOrderOption[] = [];
  shippingLabelsUploads: ShippingLabelsUploadItem[] = [];
  shippingLabelsBusy = false;

  tagManagerOpen = signal(false);
  tagManagerLoading = signal(false);
  tagManagerError = signal<string | null>(null);
  tagManagerQuery = '';
  tagManagerRows = signal<AdminOrderTagStat[]>([]);
  tagRenameFrom = '';
  tagRenameTo = '';
  tagRenameBusy = false;
  tagRenameError = '';

  readonly tagColorPalette: TagColor[] = TAG_COLOR_PALETTE;
  private tagColorOverrides: Record<string, TagColor> = {};

  constructor(
    private readonly ordersApi: AdminOrdersService,
    private readonly router: Router,
    private readonly toast: ToastService,
    private readonly translate: TranslateService,
    private readonly auth: AuthService,
    public favorites: AdminFavoritesService
  ) {}

  ngOnInit(): void {
    this.tagColorOverrides = loadTagColorOverrides();
    this.favorites.init();
    this.tableLayout.set(loadAdminTableLayout(this.tableLayoutStorageKey(), this.tableColumns, this.tableDefaults));
    this.viewMode.set(this.loadViewMode());
    this.presets = this.loadPresets();
    this.loadExportState();
    this.maybeApplyFiltersFromState();
    this.refreshTagOptions();
    this.load();
  }

  openLayoutModal(): void {
    this.layoutModalOpen.set(true);
  }

  closeLayoutModal(): void {
    this.layoutModalOpen.set(false);
  }

  applyTableLayout(layout: AdminTableLayoutV1): void {
    this.tableLayout.set(layout);
    saveAdminTableLayout(this.tableLayoutStorageKey(), layout);
  }

  toggleDensity(): void {
    const current = this.tableLayout();
    const next: AdminTableLayoutV1 = {
      ...current,
      density: current.density === 'compact' ? 'comfortable' : 'compact',
    };
    this.applyTableLayout(next);
  }

  densityToggleLabelKey(): string {
    return this.tableLayout().density === 'compact'
      ? 'adminUi.tableLayout.densityToggle.toComfortable'
      : 'adminUi.tableLayout.densityToggle.toCompact';
  }

  viewToggleLabelKey(): string {
    return this.viewMode() === 'kanban' ? 'adminUi.orders.viewMode.table' : 'adminUi.orders.viewMode.kanban';
  }

  toggleViewMode(): void {
    const next: AdminOrdersViewMode = this.viewMode() === 'kanban' ? 'table' : 'kanban';
    this.viewMode.set(next);
    this.persistViewMode();
    this.clearSelection();
    this.load();
  }

  kanbanColumnStatuses(): KanbanStatus[] {
    if (this.status === 'pending') return ['pending_payment', 'pending_acceptance'];
    if (this.status === 'sales') return ['paid', 'shipped', 'delivered', 'refunded'];
    if (this.status === 'all')
      return ['pending_payment', 'pending_acceptance', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'];
    return [this.status as KanbanStatus];
  }

  trackKanbanStatus(_: number, status: KanbanStatus): string {
    return status;
  }

  kanbanTotalCards(): number {
    const items = this.kanbanItemsByStatus();
    return this.kanbanColumnStatuses().reduce((sum, status) => sum + (items[status]?.length ?? 0), 0);
  }

  onKanbanDrop(event: CdkDragDrop<AdminOrderListItem[]>, targetStatus: KanbanStatus): void {
    if (this.kanbanBusy()) return;
    const order = event.item.data as AdminOrderListItem;
    const sourceStatus = (order?.status ?? '').toString() as KanbanStatus;
    if (!order?.id || !sourceStatus) return;

    if (sourceStatus === targetStatus) {
      const itemsByStatus = this.kanbanItemsByStatus();
      const columnItems = [...(itemsByStatus[sourceStatus] ?? [])];
      moveItemInArray(columnItems, event.previousIndex, event.currentIndex);
      this.kanbanItemsByStatus.set({ ...itemsByStatus, [sourceStatus]: columnItems });
      return;
    }

    const allowed = this.allowedKanbanTransitions(order);
    if (!allowed.includes(targetStatus)) {
      this.toast.error(this.translate.instant('adminUi.orders.kanban.errors.invalidTransition'));
      return;
    }

    let cancelReason: string | null | undefined = undefined;
    if (targetStatus === 'cancelled') {
      cancelReason = (window.prompt(this.translate.instant('adminUi.orders.kanban.cancelPrompt')) ?? '').trim();
      if (!cancelReason) {
        this.toast.error(this.translate.instant('adminUi.orders.kanban.errors.cancelReasonRequired'));
        return;
      }
    }

    if (targetStatus === 'refunded') {
      const ok = window.confirm(this.translate.instant('adminUi.orders.kanban.refundConfirm'));
      if (!ok) return;
    }

    const prevItemsByStatus = this.kanbanItemsByStatus();
    const prevTotalsByStatus = this.kanbanTotalsByStatus();
    const sourceItems = [...(prevItemsByStatus[sourceStatus] ?? [])];
    const targetItems = [...(prevItemsByStatus[targetStatus] ?? [])];
    transferArrayItem(sourceItems, targetItems, event.previousIndex, event.currentIndex);
    order.status = targetStatus;
    this.kanbanItemsByStatus.set({
      ...prevItemsByStatus,
      [sourceStatus]: sourceItems,
      [targetStatus]: targetItems,
    });
    this.kanbanTotalsByStatus.set({
      ...prevTotalsByStatus,
      [sourceStatus]: Math.max(0, (prevTotalsByStatus[sourceStatus] ?? sourceItems.length + 1) - 1),
      [targetStatus]: (prevTotalsByStatus[targetStatus] ?? Math.max(0, targetItems.length - 1)) + 1,
    });

    this.kanbanBusy.set(true);
    this.ordersApi
      .update(order.id, { status: targetStatus, cancel_reason: cancelReason ?? undefined })
      .pipe(
        finalize(() => {
          this.kanbanBusy.set(false);
        })
      )
      .subscribe({
        next: (updated) => {
          order.status = (updated?.status ?? targetStatus);
          this.toast.success(this.translate.instant('adminUi.orders.kanban.success.updated'));
        },
        error: () => {
          order.status = sourceStatus;
          this.kanbanItemsByStatus.set(prevItemsByStatus);
          this.kanbanTotalsByStatus.set(prevTotalsByStatus);
          this.toast.error(this.translate.instant('adminUi.orders.kanban.errors.updateFailed'));
        }
      });
  }

  private allowedKanbanTransitions(order: AdminOrderListItem): KanbanStatus[] {
    const current = (order?.status ?? '').toString() as KanbanStatus;
    const base: Record<string, KanbanStatus[]> = {
      pending_payment: ['pending_acceptance', 'cancelled'],
      pending_acceptance: ['paid', 'cancelled'],
      paid: ['shipped', 'refunded', 'cancelled'],
      shipped: ['delivered', 'refunded'],
      delivered: ['refunded'],
      cancelled: [],
      refunded: []
    };
    const allowed = [...(base[current] ?? [])];
    const method = order.payment_method ? String(order.payment_method).trim().toLowerCase() : '';
    if (method === 'cod' && current === 'pending_acceptance') {
      allowed.push('shipped', 'delivered');
    }
    return Array.from(new Set(allowed));
  }

  scrollToBulkActions(): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('admin-orders-bulk-actions');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      const focusable = el.querySelector<HTMLElement>('select, input, button, [href], [tabindex]:not([tabindex="-1"])');
      focusable?.focus();
    }, 0);
  }

  visibleColumnIds(): string[] {
    return visibleAdminTableColumnIds(this.tableLayout(), this.tableColumns);
  }

  trackColumnId(_: number, colId: string): string {
    return colId;
  }

  cellPaddingClass(): string {
    return adminTableCellPaddingClass(this.tableLayout().density);
  }

  applyFilters(): void {
    this.page = 1;
    this.selectedPresetId = '';
    this.clearSelection();
    this.load();
  }

  resetFilters(): void {
    this.q = '';
    this.status = 'all';
    this.sla = 'all';
    this.fraud = 'all';
    this.tag = '';
    this.fromDate = '';
    this.toDate = '';
    this.includeTestOrders = true;
    this.page = 1;
    this.selectedPresetId = '';
    this.selectedSavedViewKey = '';
    this.clearSelection();
    this.load();
  }

  applyPreset(presetId: string): void {
    this.selectedPresetId = presetId;
    if (!presetId) return;
    const preset = this.presets.find((candidate) => candidate.id === presetId);
    if (!preset) return;

    this.q = preset.filters.q;
    this.status = preset.filters.status;
    this.sla = preset.filters.sla ?? 'all';
    this.fraud = preset.filters.fraud ?? 'all';
    this.tag = preset.filters.tag;
    this.fromDate = preset.filters.fromDate;
    this.toDate = preset.filters.toDate;
    this.includeTestOrders = Boolean(preset.filters.includeTestOrders);
    this.limit = preset.filters.limit;
    this.page = 1;
    this.selectedSavedViewKey = '';
    this.clearSelection();
    this.load();
  }

  savedViews(): AdminFavoriteItem[] {
    return this.favorites
      .items()
      .filter((item) => item?.type === 'filter' && (item?.state)?.['adminFilterScope'] === 'orders');
  }

  applySavedView(key: string): void {
    this.selectedSavedViewKey = key;
    if (!key) return;
    const view = this.savedViews().find((item) => item.key === key);
    const filters = view?.state && typeof view.state === 'object' ? (view.state as any).adminFilters : null;
    if (!filters || typeof filters !== 'object') return;

    this.q = String(filters.q ?? '');
    this.status = (filters.status ?? 'all') as OrderStatusFilter;
    this.sla = (filters.sla ?? 'all') as SlaFilter;
    this.fraud = (filters.fraud ?? 'all') as FraudFilter;
    this.tag = String(filters.tag ?? '');
    this.fromDate = String(filters.fromDate ?? '');
    this.toDate = String(filters.toDate ?? '');
    this.includeTestOrders = Boolean(filters.includeTestOrders ?? true);
    const nextLimit = typeof filters.limit === 'number' && Number.isFinite(filters.limit) ? filters.limit : 20;
    this.limit = nextLimit;
    this.page = 1;
    this.selectedPresetId = '';
    this.clearSelection();
    this.load();
  }

  isCurrentViewPinned(): boolean {
    return this.favorites.isFavorite(this.currentViewFavoriteKey());
  }

  toggleCurrentViewPin(): void {
    const key = this.currentViewFavoriteKey();
    if (this.favorites.isFavorite(key)) {
      this.favorites.remove(key);
      if (this.selectedSavedViewKey === key) this.selectedSavedViewKey = '';
      return;
    }

    const name = (window.prompt(this.translate.instant('adminUi.favorites.savedViews.prompt')) ?? '').trim();
    if (!name) {
      this.toast.error(this.translate.instant('adminUi.favorites.savedViews.errors.nameRequired'));
      return;
    }

    const filters = this.currentViewFilters();
    this.favorites.add({
      key,
      type: 'filter',
      label: name,
      subtitle: '',
      url: '/admin/orders',
      state: { adminFilterScope: 'orders', adminFilters: filters }
    });
    this.selectedSavedViewKey = key;
  }

  private maybeApplyFiltersFromState(): void {
    const state = history.state;
    const scope = (state?.adminFilterScope || '').toString();
    if (scope !== 'orders') return;
    const filters = state?.adminFilters;
    if (!filters || typeof filters !== 'object') return;

    this.q = String(filters.q ?? '');
    this.status = (filters.status ?? 'all') as OrderStatusFilter;
    this.sla = (filters.sla ?? 'all') as SlaFilter;
    this.fraud = (filters.fraud ?? 'all') as FraudFilter;
    this.tag = String(filters.tag ?? '');
    this.fromDate = String(filters.fromDate ?? '');
    this.toDate = String(filters.toDate ?? '');
    this.includeTestOrders = Boolean(filters.includeTestOrders ?? true);
    const nextLimit = typeof filters.limit === 'number' && Number.isFinite(filters.limit) ? filters.limit : this.limit;
    this.limit = nextLimit;
    this.page = 1;
    this.selectedPresetId = '';
    this.selectedSavedViewKey = this.currentViewFavoriteKey();
  }

  private currentViewFilters(): AdminOrdersFilterPreset['filters'] {
    return {
      q: this.q,
      status: this.status,
      sla: this.sla,
      fraud: this.fraud,
      tag: this.tag,
      fromDate: this.fromDate,
      toDate: this.toDate,
      includeTestOrders: this.includeTestOrders,
      limit: this.limit
    };
  }

  private currentViewFavoriteKey(): string {
    return adminFilterFavoriteKey('orders', this.currentViewFilters());
  }

  savePreset(): void {
    const name = (window.prompt(this.translate.instant('adminUi.orders.presets.prompt')) ?? '').trim();
    if (!name) {
      this.toast.error(this.translate.instant('adminUi.orders.presets.errors.nameRequired'));
      return;
    }

    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const preset: AdminOrdersFilterPreset = {
      id,
      name,
      createdAt: new Date().toISOString(),
      filters: {
        q: this.q,
        status: this.status,
        sla: this.sla,
        fraud: this.fraud,
        tag: this.tag,
        fromDate: this.fromDate,
        toDate: this.toDate,
        includeTestOrders: this.includeTestOrders,
        limit: this.limit
      }
    };

    this.presets = [preset, ...this.presets].slice(0, 20);
    this.selectedPresetId = preset.id;
    this.persistPresets();
    this.toast.success(this.translate.instant('adminUi.orders.presets.success.saved'));
  }

  deletePreset(): void {
    const preset = this.presets.find((candidate) => candidate.id === this.selectedPresetId);
    if (!preset) return;
    const ok = window.confirm(
      this.translate.instant('adminUi.orders.presets.confirmDelete', {
        name: preset.name
      })
    );
    if (!ok) return;

    this.presets = this.presets.filter((candidate) => candidate.id !== preset.id);
    this.selectedPresetId = '';
    this.persistPresets();
    this.toast.success(this.translate.instant('adminUi.orders.presets.success.deleted'));
  }

  toggleSelected(orderId: string, selected: boolean): void {
    if (this.bulkBusy) return;
    if (selected) this.selectedIds.add(orderId);
    else this.selectedIds.delete(orderId);
  }

  toggleSelectAllOnPage(selected: boolean): void {
    if (this.bulkBusy) return;
    const ids = this.orders().map((order) => order.id);
    if (!ids.length) return;
    if (selected) ids.forEach((id) => this.selectedIds.add(id));
    else ids.forEach((id) => this.selectedIds.delete(id));
  }

  allSelectedOnPage(): boolean {
    const ids = this.orders().map((order) => order.id);
    return ids.length > 0 && ids.every((id) => this.selectedIds.has(id));
  }

  someSelectedOnPage(): boolean {
    const ids = this.orders().map((order) => order.id);
    if (!ids.length) return false;
    const any = ids.some((id) => this.selectedIds.has(id));
    return any && !this.allSelectedOnPage();
  }

  clearSelection(): void {
    this.selectedIds.clear();
  }

  applyBulkUpdate(): void {
    if (!this.selectedIds.size) return;
    if (!this.bulkStatus && !this.bulkCourier) {
      this.toast.error(this.translate.instant('adminUi.orders.bulk.errors.chooseAction'));
      return;
    }

    const payload: Parameters<AdminOrdersService['update']>[1] = {};
    if (this.bulkStatus) payload.status = this.bulkStatus;
    if (this.bulkCourier === 'clear') payload.courier = null;
    else if (this.bulkCourier) payload.courier = this.bulkCourier;

    const ids = Array.from(this.selectedIds);
    this.bulkBusy = true;
    from(ids)
      .pipe(
        mergeMap(
          (id) =>
            this.ordersApi.update(id, payload).pipe(
              map(() => ({ id, ok: true as const })),
              catchError(() => of({ id, ok: false as const }))
            ),
          3
        ),
        toArray(),
        finalize(() => {
          this.bulkBusy = false;
        })
      )
      .subscribe((results) => {
        const failed = results.filter((r) => !r.ok).map((r) => r.id);
        const successCount = results.length - failed.length;
        if (failed.length) {
          this.selectedIds = new Set(failed);
          this.toast.error(
            this.translate.instant('adminUi.orders.bulk.partial', {
              success: successCount,
              total: results.length
            })
          );
        } else {
          this.clearSelection();
          this.toast.success(this.translate.instant('adminUi.orders.bulk.success', { count: results.length }));
        }
        this.bulkStatus = '';
        this.bulkCourier = '';
        this.bulkEmailKind = '';
        this.load();
      });
  }

  resendBulkEmails(): void {
    if (!this.selectedIds.size) return;
    if (!this.bulkEmailKind) {
      this.toast.error(this.translate.instant('adminUi.orders.bulk.errors.chooseEmail'));
      return;
    }

    const notePrompt = this.translate.instant('adminUi.orders.bulk.emailNotePrompt');
    const noteRaw = window.prompt(notePrompt) ?? null;
    if (noteRaw === null) return;
    const note = noteRaw.trim() || null;

    const ids = Array.from(this.selectedIds);
    this.bulkBusy = true;
    from(ids)
      .pipe(
        mergeMap(
          (id) => {
            const req =
              this.bulkEmailKind === 'delivery'
                ? this.ordersApi.resendDeliveryEmail(id, note)
                : this.ordersApi.resendOrderConfirmationEmail(id, note);
            return req.pipe(
              map(() => ({ id, ok: true as const })),
              catchError(() => of({ id, ok: false as const }))
            );
          },
          3
        ),
        toArray(),
        finalize(() => {
          this.bulkBusy = false;
        })
      )
      .subscribe((results) => {
        const failed = results.filter((r) => !r.ok).map((r) => r.id);
        const successCount = results.length - failed.length;
        if (failed.length) {
          this.selectedIds = new Set(failed);
          this.toast.error(
            this.translate.instant('adminUi.orders.bulk.emailsPartial', {
              success: successCount,
              total: results.length
            })
          );
        } else {
          this.clearSelection();
          this.toast.success(this.translate.instant('adminUi.orders.bulk.emailsQueued', { count: results.length }));
        }
        this.bulkEmailKind = '';
      });
  }

  downloadBatchPackingSlips(): void {
    if (!this.selectedIds.size) return;
    const ids = Array.from(this.selectedIds);
    this.bulkBusy = true;
    this.ordersApi.downloadBatchPackingSlips(ids).subscribe({
      next: (blob) => {
        this.downloadBlob(blob, 'packing-slips.pdf');
        this.toast.success(this.translate.instant('adminUi.orders.bulk.packingSlipsReady'));
        this.bulkBusy = false;
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.bulk.errors.packingSlips'));
        this.bulkBusy = false;
      }
    });
  }

  downloadPickListCsv(): void {
    if (!this.selectedIds.size) return;
    const ids = Array.from(this.selectedIds);
    this.bulkBusy = true;
    this.ordersApi.downloadPickListCsv(ids).subscribe({
      next: (blob) => {
        this.downloadBlob(blob, 'pick-list.csv');
        this.toast.success(this.translate.instant('adminUi.orders.bulk.pickListReady'));
        this.bulkBusy = false;
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.bulk.errors.pickList'));
        this.bulkBusy = false;
      }
    });
  }

  downloadPickListPdf(): void {
    if (!this.selectedIds.size) return;
    const ids = Array.from(this.selectedIds);
    this.bulkBusy = true;
    this.ordersApi.downloadPickListPdf(ids).subscribe({
      next: (blob) => {
        this.downloadBlob(blob, 'pick-list.pdf');
        this.toast.success(this.translate.instant('adminUi.orders.bulk.pickListReady'));
        this.bulkBusy = false;
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.bulk.errors.pickList'));
        this.bulkBusy = false;
      }
    });
  }

  openShippingLabelsModal(): void {
    if (!this.selectedIds.size) return;
    this.shippingLabelsOrderOptions = this.buildShippingLabelsOrderOptions();
    this.shippingLabelsUploads = [];
    this.shippingLabelsModalOpen.set(true);
  }

  closeShippingLabelsModal(): void {
    if (this.shippingLabelsBusy) return;
    this.shippingLabelsModalOpen.set(false);
    this.shippingLabelsUploads = [];
    this.shippingLabelsOrderOptions = [];
  }

  onShippingLabelsSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const files = input?.files ? Array.from(input.files) : [];
    if (!files.length) return;
    const nextUploads: ShippingLabelsUploadItem[] = files.map((file) => ({
      file,
      assignedOrderId: this.autoAssignShippingLabel(file),
      status: 'pending',
      error: null
    }));
    this.shippingLabelsUploads = [...this.shippingLabelsUploads, ...nextUploads].slice(0, 50);
    if (input) input.value = '';
  }

  uploadAllShippingLabels(): void {
    if (this.shippingLabelsBusy) return;
    if (!this.shippingLabelsUploads.length) return;

    const uploadTargets = this.shippingLabelsUploads
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status !== 'success');
    if (!uploadTargets.length) return;

    this.shippingLabelsBusy = true;
    from(uploadTargets)
      .pipe(
        mergeMap(
          ({ item, index }) => {
            const orderId = (item.assignedOrderId ?? '').trim();
            if (!orderId) {
              this.updateShippingLabelUpload(index, {
                status: 'error',
                error: this.translate.instant('adminUi.orders.shippingLabelsModal.errors.missingOrder')
              });
              return of({ index, ok: false as const });
            }
            this.updateShippingLabelUpload(index, { status: 'uploading', error: null });
            return this.ordersApi.uploadShippingLabel(orderId, item.file).pipe(
              map(() => ({ index, ok: true as const })),
              catchError((err) => of({ index, ok: false as const, err }))
            );
          },
          2
        ),
        toArray(),
        finalize(() => {
          this.shippingLabelsBusy = false;
        })
      )
      .subscribe((results) => {
        const failed = results.filter((r) => !r.ok);
        for (const result of results) {
          if (result.ok) {
            this.updateShippingLabelUpload(result.index, { status: 'success', error: null });
            continue;
          }
          const requestId = 'err' in result ? extractRequestId(result.err) : null;
          const suffix = requestId ? ` (${requestId})` : '';
          this.updateShippingLabelUpload(result.index, {
            status: 'error',
            error: `${this.translate.instant('adminUi.orders.shippingLabelsModal.errors.uploadFailed')}${suffix}`
          });
        }
        if (failed.length) {
          this.toast.error(
            this.translate.instant('adminUi.orders.shippingLabelsModal.errors.partial', {
              success: results.length - failed.length,
              total: results.length
            })
          );
          return;
        }
        this.toast.success(this.translate.instant('adminUi.orders.shippingLabelsModal.success.uploaded'));
      });
  }

  retryShippingLabelUpload(index: number): void {
    const item = this.shippingLabelsUploads[index];
    if (!item || this.shippingLabelsBusy) return;
    const orderId = (item.assignedOrderId ?? '').trim();
    if (!orderId) {
      this.updateShippingLabelUpload(index, {
        status: 'error',
        error: this.translate.instant('adminUi.orders.shippingLabelsModal.errors.missingOrder')
      });
      return;
    }
    this.shippingLabelsBusy = true;
    this.updateShippingLabelUpload(index, { status: 'uploading', error: null });
    this.ordersApi
      .uploadShippingLabel(orderId, item.file)
      .pipe(
        finalize(() => {
          this.shippingLabelsBusy = false;
        })
      )
      .subscribe({
        next: () => {
          this.updateShippingLabelUpload(index, { status: 'success', error: null });
          this.toast.success(this.translate.instant('adminUi.orders.shippingLabelsModal.success.uploaded'));
        },
        error: (err) => {
          const requestId = extractRequestId(err);
          const suffix = requestId ? ` (${requestId})` : '';
          this.updateShippingLabelUpload(index, {
            status: 'error',
            error: `${this.translate.instant('adminUi.orders.shippingLabelsModal.errors.uploadFailed')}${suffix}`
          });
          this.toast.error(this.translate.instant('adminUi.orders.shippingLabelsModal.errors.uploadFailed'));
        }
      });
  }

  downloadSelectedShippingLabelsZip(): void {
    if (!this.selectedIds.size || this.shippingLabelsBusy) return;
    const ids = Array.from(this.selectedIds);
    this.shippingLabelsBusy = true;
    this.ordersApi.downloadBatchShippingLabelsZip(ids).subscribe({
      next: (blob) => {
        this.downloadBlob(blob, 'shipping-labels.zip');
        this.toast.success(this.translate.instant('adminUi.orders.shippingLabelsModal.success.zipReady'));
        this.shippingLabelsBusy = false;
      },
      error: (err) => {
        const detail = (err?.error?.detail ?? null);
        const missing: string[] = Array.isArray(detail?.missing_shipping_label_order_ids)
          ? detail.missing_shipping_label_order_ids
          : [];
        if (missing.length) {
          this.toast.error(
            this.translate.instant('adminUi.orders.shippingLabelsModal.errors.missingLabels', { count: missing.length })
          );
        } else {
          this.toast.error(this.translate.instant('adminUi.orders.shippingLabelsModal.errors.zipFailed'));
        }
        this.shippingLabelsBusy = false;
      }
    });
  }

  shippingLabelStatusLabelKey(status: ShippingLabelsUploadStatus): string {
    return `adminUi.orders.shippingLabelsModal.status.${status}`;
  }

  shippingLabelStatusPillClass(status: ShippingLabelsUploadStatus): string {
    switch (status) {
      case 'success':
        return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200';
      case 'uploading':
        return 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-200';
      case 'error':
        return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200';
      default:
        return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200';
    }
  }

  private updateShippingLabelUpload(index: number, patch: Partial<ShippingLabelsUploadItem>): void {
    const next = this.shippingLabelsUploads.slice();
    if (!next[index]) return;
    next[index] = { ...next[index], ...patch };
    this.shippingLabelsUploads = next;
  }

  private autoAssignShippingLabel(file: File): string | null {
    const name = (file?.name ?? '').toLowerCase();
    for (const opt of this.shippingLabelsOrderOptions) {
      if (opt.ref && name.includes(opt.ref.toLowerCase())) return opt.id;
    }
    for (const opt of this.shippingLabelsOrderOptions) {
      if (opt.shortId && name.includes(opt.shortId.toLowerCase())) return opt.id;
    }
    return null;
  }

  private buildShippingLabelsOrderOptions(): ShippingLabelsOrderOption[] {
    const orders = this.orders();
    const byId = new Map<string, AdminOrderListItem>();
    for (const order of orders) byId.set(order.id, order);
    return Array.from(this.selectedIds).map((id) => {
      const order = byId.get(id);
      const ref = (order?.reference_code ?? '').toString().trim();
      const shortId = id.slice(0, 8);
      const label = ref ? `${ref} (${shortId})` : shortId;
      return { id, ref, shortId, label };
    });
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  goToPage(page: number): void {
    this.page = page;
    this.load();
  }

  trackOrderId(_: number, order: AdminOrderListItem): string {
    return order.id;
  }

  open(orderId: string): void {
    const queryParams: Record<string, string | number | boolean> = {
      nav: 1,
      nav_page: this.page,
      nav_limit: this.limit
    };
    const q = this.q.trim();
    if (q) queryParams['nav_q'] = q;
    if (this.status !== 'all') queryParams['nav_status'] = this.status;
    if (this.sla !== 'all') queryParams['nav_sla'] = this.sla;
    if (this.fraud !== 'all') queryParams['nav_fraud'] = this.fraud;
    const tag = this.tag.trim();
    if (tag) queryParams['nav_tag'] = tag;
    if (!this.includeTestOrders) queryParams['nav_include_test'] = 0;
    if (this.fromDate) queryParams['nav_from'] = `${this.fromDate}T00:00:00Z`;
    if (this.toDate) queryParams['nav_to'] = `${this.toDate}T23:59:59Z`;

    void this.router.navigate(['/admin/orders', orderId], { queryParams });
  }

  openExports(): void {
    void this.router.navigate(['/admin/orders/exports']);
  }

  openExportModal(): void {
    this.exportModalOpen.set(true);
  }

  closeExportModal(): void {
    this.exportModalOpen.set(false);
  }

  toggleExportColumn(column: string, checked: boolean): void {
    if (!this.exportColumnOptions.includes(column)) return;
    this.exportColumns = { ...this.exportColumns, [column]: checked };
    this.selectedExportTemplateId = '';
    this.persistExportState();
  }

  applyExportTemplate(templateId: string): void {
    this.selectedExportTemplateId = templateId || '';
    if (!this.selectedExportTemplateId) {
      this.persistExportState();
      return;
    }
    const tpl = this.exportTemplates.find((candidate) => candidate.id === this.selectedExportTemplateId);
    if (!tpl) return;
    const cols = (tpl.columns || []).filter((c) => this.exportColumnOptions.includes(c));
    this.exportColumns = {};
    this.exportColumnOptions.forEach((c) => (this.exportColumns[c] = cols.includes(c)));
    this.persistExportState();
  }

  private selectedExportColumns(): string[] {
    return this.exportColumnOptions.filter((c) => !!this.exportColumns[c]);
  }

  downloadExport(): void {
    const columns = this.selectedExportColumns();
    if (!columns.length) {
      this.toast.error(this.translate.instant('adminUi.orders.exportModal.errors.noColumns'));
      return;
    }
    this.ordersApi.downloadExport(columns).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'orders.csv';
        a.click();
        URL.revokeObjectURL(url);
        this.closeExportModal();
      },
      error: () => this.toast.error(this.translate.instant('adminUi.orders.errors.export'))
    });
  }

  saveExportTemplate(): void {
    const columns = this.selectedExportColumns();
    if (!columns.length) {
      this.toast.error(this.translate.instant('adminUi.orders.exportModal.errors.noColumns'));
      return;
    }
    const name = (window.prompt(this.translate.instant('adminUi.orders.exportModal.templatePrompt')) ?? '').trim();
    if (!name) {
      this.toast.error(this.translate.instant('adminUi.orders.exportModal.errors.templateNameRequired'));
      return;
    }

    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const template: AdminOrdersExportTemplate = {
      id,
      name,
      createdAt: new Date().toISOString(),
      columns
    };
    this.exportTemplates = [template, ...this.exportTemplates].slice(0, 20);
    this.selectedExportTemplateId = template.id;
    this.persistExportState();
    this.toast.success(this.translate.instant('adminUi.orders.exportModal.success.saved'));
  }

  deleteExportTemplate(): void {
    const tpl = this.exportTemplates.find((candidate) => candidate.id === this.selectedExportTemplateId);
    if (!tpl) return;
    const ok = window.confirm(
      this.translate.instant('adminUi.orders.exportModal.confirmDelete', {
        name: tpl.name
      })
    );
    if (!ok) return;
    this.exportTemplates = this.exportTemplates.filter((candidate) => candidate.id !== tpl.id);
    this.selectedExportTemplateId = '';
    this.persistExportState();
    this.toast.success(this.translate.instant('adminUi.orders.exportModal.success.deleted'));
  }

  customerLabel(order: AdminOrderListItem): string {
    const email = (order.customer_email ?? '').trim();
    const username = (order.customer_username ?? '').trim();
    if (email && username) return `${email} (${username})`;
    return email || username || this.translate.instant('adminUi.orders.guest');
  }

  tagLabel(tag: string): string {
    const key = `adminUi.orders.tags.${tag}`;
    const translated = this.translate.instant(key);
    return translated === key ? tag : translated;
  }

  tagChipColorClass(tag: string): string {
    return tagChipColorClassFromHelper(tag, this.tagColorOverrides);
  }

  openTagManager(): void {
    this.tagManagerOpen.set(true);
    this.tagManagerError.set(null);
    this.tagRenameError = '';
    this.tagRenameFrom = '';
    this.tagRenameTo = '';
    this.reloadTagManager();
  }

  closeTagManager(): void {
    this.tagManagerOpen.set(false);
    this.tagManagerError.set(null);
    this.tagManagerQuery = '';
    this.tagManagerRows.set([]);
    this.tagRenameError = '';
  }

  reloadTagManager(): void {
    this.tagManagerLoading.set(true);
    this.tagManagerError.set(null);
    this.ordersApi.listOrderTagStats().subscribe({
      next: (rows) => {
        this.tagManagerRows.set(rows || []);
        this.tagManagerLoading.set(false);
      },
      error: () => {
        this.tagManagerError.set(this.translate.instant('adminUi.orders.tags.errors.load'));
        this.tagManagerLoading.set(false);
      }
    });
    this.refreshTagOptions();
  }

  filteredTagManagerRows(): AdminOrderTagStat[] {
    const rows = this.tagManagerRows();
    const q = (this.tagManagerQuery || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const tag = (row.tag || '').toLowerCase();
      const label = (this.tagLabel(row.tag) || '').toLowerCase();
      return tag.includes(q) || label.includes(q);
    });
  }

  tagColorValue(tag: string): TagColor {
    return tagColorFor(tag, this.tagColorOverrides);
  }

  setTagColor(tag: string, value: string): void {
    const normalizedTag = normalizeTagKey(tag);
    const color = (value || '').toString().trim() as TagColor;
    if (!normalizedTag || !this.tagColorPalette.includes(color)) return;
    this.tagColorOverrides[normalizedTag] = color;
    persistTagColorOverrides(this.tagColorOverrides);
  }

  resetTagColor(tag: string): void {
    const normalizedTag = normalizeTagKey(tag);
    if (!normalizedTag) return;
    delete this.tagColorOverrides[normalizedTag];
    persistTagColorOverrides(this.tagColorOverrides);
  }

  applyBulkTags(): void {
    if (!this.selectedIds.size) return;
    const addTag = (this.bulkTagAdd || '').trim();
    const removeTag = (this.bulkTagRemove || '').trim();
    if (!addTag && !removeTag) {
      this.toast.error(this.translate.instant('adminUi.orders.bulk.errors.chooseTagAction'));
      return;
    }

    const ops: { kind: 'add' | 'remove'; tag: string }[] = [];
    if (removeTag) ops.push({ kind: 'remove', tag: removeTag });
    if (addTag) ops.push({ kind: 'add', tag: addTag });

    const ids = Array.from(this.selectedIds);
    this.bulkBusy = true;
    from(ids)
      .pipe(
        mergeMap(
          (id) =>
            from(ops).pipe(
              concatMap((op) =>
                op.kind === 'add'
                  ? this.ordersApi.addOrderTag(id, op.tag).pipe(
                      map(() => true),
                      catchError(() => of(false))
                    )
                  : this.ordersApi.removeOrderTag(id, op.tag).pipe(
                      map(() => true),
                      catchError(() => of(false))
                    )
              ),
              toArray(),
              map((results) => ({ id, ok: results.every(Boolean) }))
            ),
          3
        ),
        toArray(),
        finalize(() => {
          this.bulkBusy = false;
        })
      )
      .subscribe((results) => {
        const failed = results.filter((r) => !r.ok).map((r) => r.id);
        const successCount = results.length - failed.length;
        if (failed.length) {
          this.selectedIds = new Set(failed);
          this.toast.error(
            this.translate.instant('adminUi.orders.bulk.partial', {
              success: successCount,
              total: results.length
            })
          );
        } else {
          this.clearSelection();
          this.toast.success(this.translate.instant('adminUi.orders.bulk.success', { count: results.length }));
        }
        this.bulkTagAdd = '';
        this.bulkTagRemove = '';
        this.refreshTagOptions();
        this.load();
      });
  }

  renameTag(): void {
    if (this.tagRenameBusy) return;
    const fromTag = (this.tagRenameFrom || '').trim();
    const toTag = (this.tagRenameTo || '').trim();
    if (!fromTag || !toTag) {
      this.tagRenameError = this.translate.instant('adminUi.orders.tags.errors.renameRequired');
      return;
    }
    const ok = window.confirm(
      this.translate.instant('adminUi.orders.tags.renameConfirm', { from: fromTag, to: toTag })
    );
    if (!ok) return;

    this.tagRenameBusy = true;
    this.tagRenameError = '';
    this.ordersApi.renameOrderTag({ from_tag: fromTag, to_tag: toTag }).subscribe({
      next: (res) => this.handleTagRenameSuccess(res, fromTag, toTag),
      error: (err) => {
        this.tagRenameError = err?.error?.detail || this.translate.instant('adminUi.orders.tags.errors.rename');
      },
      complete: () => {
        this.tagRenameBusy = false;
      }
    });
  }

  private handleTagRenameSuccess(
    res: { from_tag?: string | null; to_tag?: string | null; total: number },
    fromTag: string,
    toTag: string
  ): void {
    const fromKey = normalizeTagKey(res.from_tag || fromTag);
    const toKey = normalizeTagKey(res.to_tag || toTag);
    this.copyTagColorOverride(fromKey, toKey);
    if (fromKey) delete this.tagColorOverrides[fromKey];
    persistTagColorOverrides(this.tagColorOverrides);

    if (this.tag === fromKey) this.tag = toKey;
    this.toast.success(this.translate.instant('adminUi.orders.tags.renamed', { count: res.total }));
    this.tagRenameFrom = '';
    this.tagRenameTo = '';
    this.reloadTagManager();
    this.load();
  }

  private copyTagColorOverride(fromKey: string, toKey: string): void {
    if (!fromKey || !toKey) return;
    if (!this.tagColorOverrides[fromKey] || this.tagColorOverrides[toKey]) return;
    this.tagColorOverrides[toKey] = this.tagColorOverrides[fromKey];
  }

  private refreshTagOptions(): void {
    this.ordersApi.listOrderTags().subscribe({
      next: (tags) => {
        const merged = new Set<string>(['vip', 'fraud_risk', 'fraud_approved', 'fraud_denied', 'gift', 'test']);
        for (const t of tags) merged.add(t);
        this.tagOptions.set(Array.from(merged).sort((a, b) => a.localeCompare(b, 'en')));
      },
      error: () => {
        // ignore
      }
    });
  }

  statusPillClass(status: string): string {
    return orderStatusChipClass(status);
  }

  slaBadge(
    order: AdminOrderListItem
  ): { label: string; title: string; className: string } | null {
    const kind = (order?.sla_kind ?? '').toString().trim().toLowerCase();
    const dueRaw = (order?.sla_due_at ?? '').toString().trim();
    if (!kind || !dueRaw) return null;
    const dueTs = Date.parse(dueRaw);
    if (!Number.isFinite(dueTs)) return null;

    const kindKey =
      kind === 'accept'
        ? 'adminUi.orders.sla.badges.accept'
        : kind === 'ship'
          ? 'adminUi.orders.sla.badges.ship'
          : null;
    if (!kindKey) return null;

    const kindLabel = this.translate.instant(kindKey);
    const now = Date.now();
    const diffMs = dueTs - now;
    const time = this.formatDurationShort(Math.abs(diffMs));
    const dueSoonMs = 4 * 60 * 60 * 1000;

    if (diffMs <= 0) {
      const label = this.translate.instant('adminUi.orders.sla.badges.overdue', { kind: kindLabel, time });
      return {
        label,
        title: label,
        className:
          'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-100'
      };
    }

    if (diffMs <= dueSoonMs) {
      const label = this.translate.instant('adminUi.orders.sla.badges.dueSoon', { kind: kindLabel, time });
      return {
        label,
        title: label,
        className:
          'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100'
      };
    }

    return null;
  }

  fraudBadge(
    order: AdminOrderListItem
  ): { label: string; title: string; className: string } | null {
    const severity = (order?.fraud_severity ?? '').toString().trim().toLowerCase();
    if (!severity) return null;

    const severityKey = `adminUi.orders.fraudSignals.severity.${severity}`;
    const translatedSeverity = this.translate.instant(severityKey);
    const severityLabel = translatedSeverity === severityKey ? severity : translatedSeverity;
    const label = this.translate.instant('adminUi.orders.fraud.badges.label', { severity: severityLabel });

    const className =
      severity === 'high'
        ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-100'
        : severity === 'medium'
          ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100'
          : severity === 'low'
            ? 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-950/30 dark:text-sky-100'
            : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-100';

    return { label, title: label, className };
  }

  private formatDurationShort(ms: number): string {
    const minutes = Math.max(0, Math.round(ms / 60_000));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h`;
    const days = Math.round(hours / 24);
    return `${days}d`;
  }

  private load(): void {
    if (this.viewMode() === 'kanban') {
      this.loadKanban();
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.errorRequestId.set(null);

    const params: Parameters<AdminOrdersService['search']>[0] = {
      page: this.page,
      limit: this.limit
    };
    const q = this.q.trim();
    if (q) params.q = q;
    if (this.status !== 'all') params.status = this.status;
    if (this.sla !== 'all') params.sla = this.sla;
    if (this.fraud !== 'all') params.fraud = this.fraud;
    const tag = this.tag.trim();
    if (tag) params.tag = tag;
    if (!this.includeTestOrders) params.include_test = false;
    if (this.fromDate) params.from = `${this.fromDate}T00:00:00Z`;
    if (this.toDate) params.to = `${this.toDate}T23:59:59Z`;

    this.ordersApi.search(params).subscribe({
      next: (res) => {
        this.orders.set(res.items);
        this.meta.set(res.meta);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(this.translate.instant('adminUi.orders.errors.load'));
        this.errorRequestId.set(extractRequestId(err));
        this.loading.set(false);
      }
    });
  }

  private loadKanban(): void {
    this.loading.set(true);
    this.error.set(null);
    this.errorRequestId.set(null);
    this.orders.set([]);
    this.meta.set(null);

    const statuses = this.kanbanColumnStatuses();
    const baseParams: Parameters<AdminOrdersService['search']>[0] = {
      page: 1,
      limit: this.limit
    };
    const q = this.q.trim();
    if (q) baseParams.q = q;
    const tag = this.tag.trim();
    if (tag) baseParams.tag = tag;
    if (this.sla !== 'all') baseParams.sla = this.sla;
    if (this.fraud !== 'all') baseParams.fraud = this.fraud;
    if (!this.includeTestOrders) baseParams.include_test = false;
    if (this.fromDate) baseParams.from = `${this.fromDate}T00:00:00Z`;
    if (this.toDate) baseParams.to = `${this.toDate}T23:59:59Z`;

    from(statuses)
      .pipe(
        mergeMap(
          (statusValue) =>
            this.ordersApi.search({ ...baseParams, status: statusValue }).pipe(
              map((res) => ({ status: statusValue, res })),
              catchError((err) => of({ status: statusValue, err, res: null as any }))
            ),
          4
        ),
        toArray()
      )
      .subscribe({
        next: (results) => {
          this.applyKanbanLoadResults(results);
        },
        error: (err) => {
          this.error.set(this.translate.instant('adminUi.orders.errors.load'));
          this.errorRequestId.set(extractRequestId(err));
          this.loading.set(false);
        }
      });
  }

  private applyKanbanLoadResults(results: Array<{ status: string; res: AdminOrderListResponse | null; err?: unknown }>): void {
    const itemsByStatus: Record<string, AdminOrderListItem[]> = {};
    const totalsByStatus: Record<string, number> = {};
    const firstError = this.collectKanbanFirstError(results, itemsByStatus, totalsByStatus);

    this.kanbanItemsByStatus.set(itemsByStatus);
    this.kanbanTotalsByStatus.set(totalsByStatus);
    if (firstError) {
      this.error.set(this.translate.instant('adminUi.orders.errors.load'));
      this.errorRequestId.set(extractRequestId(firstError));
    }
    this.loading.set(false);
  }

  private collectKanbanFirstError(
    results: Array<{ status: string; res: AdminOrderListResponse | null; err?: unknown }>,
    itemsByStatus: Record<string, AdminOrderListItem[]>,
    totalsByStatus: Record<string, number>
  ): unknown {
    let firstError: unknown = null;
    for (const result of results) {
      this.applyKanbanResult(result, itemsByStatus, totalsByStatus);
      if (!firstError && !result.res && 'err' in result) firstError = result.err;
    }
    return firstError;
  }

  private applyKanbanResult(
    result: { status: string; res: AdminOrderListResponse | null; err?: unknown },
    itemsByStatus: Record<string, AdminOrderListItem[]>,
    totalsByStatus: Record<string, number>
  ): void {
    const status = result.status;
    const response = result.res;
    if (response) {
      itemsByStatus[status] = response.items ?? [];
      totalsByStatus[status] = response.meta?.total_items ?? (response.items ?? []).length;
      return;
    }
    itemsByStatus[status] = [];
    totalsByStatus[status] = 0;
  }

  retryLoad(): void {
    this.load();
  }

  private tableLayoutStorageKey(): string {
    return adminTableLayoutStorageKey('orders', this.auth.user()?.id);
  }

  private storageKey(): string {
    const userId = (this.auth.user()?.id ?? '').trim();
    return `admin.orders.filters.v1:${userId || 'anonymous'}`;
  }

  private exportStorageKey(): string {
    const userId = (this.auth.user()?.id ?? '').trim();
    return `admin.orders.export.v1:${userId || 'anonymous'}`;
  }

  private viewModeStorageKey(): string {
    const userId = (this.auth.user()?.id ?? '').trim();
    return `admin.orders.view.v1:${userId || 'anonymous'}`;
  }

  private loadViewMode(): AdminOrdersViewMode {
    try {
      const raw = localStorage.getItem(this.viewModeStorageKey());
      return raw === 'kanban' || raw === 'table' ? raw : 'table';
    } catch {
      return 'table';
    }
  }

  private persistViewMode(): void {
    try {
      localStorage.setItem(this.viewModeStorageKey(), this.viewMode());
    } catch {
      // ignore
    }
  }

  private loadExportState(): void {
    const defaultColumns = ['id', 'reference_code', 'status', 'total_amount', 'currency', 'user_id', 'created_at'];
    try {
      const raw = localStorage.getItem(this.exportStorageKey());
      if (!raw) {
        this.exportTemplates = [];
        this.selectedExportTemplateId = '';
        this.exportColumns = {};
        this.exportColumnOptions.forEach((c) => (this.exportColumns[c] = defaultColumns.includes(c)));
        return;
      }
      const parsed = JSON.parse(raw);
      const templates = Array.isArray(parsed?.templates) ? parsed.templates : [];
      this.exportTemplates = templates
        .filter((candidate: any) => typeof candidate?.id === 'string' && typeof candidate?.name === 'string')
        .map((candidate: any) => ({
          id: String(candidate.id),
          name: String(candidate.name),
          createdAt: String(candidate.createdAt ?? ''),
          columns: Array.isArray(candidate.columns) ? candidate.columns.map((c: any) => String(c)) : []
        })) as AdminOrdersExportTemplate[];

      this.selectedExportTemplateId = typeof parsed?.selectedTemplateId === 'string' ? parsed.selectedTemplateId : '';
      let columns: string[] = Array.isArray(parsed?.columns) ? parsed.columns.map((c: any) => String(c)) : [];

      if (this.selectedExportTemplateId) {
        const tpl = this.exportTemplates.find((candidate) => candidate.id === this.selectedExportTemplateId);
        if (tpl && Array.isArray(tpl.columns) && tpl.columns.length) {
          columns = tpl.columns.slice();
        }
      }

      columns = columns
        .map((c: string) => c.trim())
        .filter((c: string) => c && this.exportColumnOptions.includes(c));
      if (!columns.length) columns = defaultColumns;

      this.exportColumns = {};
      this.exportColumnOptions.forEach((c) => (this.exportColumns[c] = columns.includes(c)));
    } catch {
      this.exportTemplates = [];
      this.selectedExportTemplateId = '';
      this.exportColumns = {};
      this.exportColumnOptions.forEach((c) => (this.exportColumns[c] = defaultColumns.includes(c)));
    }
  }

  private loadPresets(): AdminOrdersFilterPreset[] {
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((candidate: any) => typeof candidate?.id === 'string' && typeof candidate?.name === 'string')
        .map((candidate: any) => this.coercePreset(candidate));
    } catch {
      return [];
    }
  }

  private coercePreset(candidate: any): AdminOrdersFilterPreset {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    const filters = source.filters && typeof source.filters === 'object' ? source.filters : {};
    return {
      id: String(source.id ?? ''),
      name: String(source.name ?? ''),
      createdAt: String(source.createdAt ?? ''),
      filters: {
        q: String(filters.q ?? ''),
        status: (filters.status ?? 'all') as OrderStatusFilter,
        sla: this.coercePresetSlaFilter(filters.sla),
        fraud: this.coercePresetFraudFilter(filters.fraud),
        tag: String(filters.tag ?? ''),
        fromDate: String(filters.fromDate ?? ''),
        toDate: String(filters.toDate ?? ''),
        includeTestOrders: this.coercePresetIncludeTestOrders(filters.includeTestOrders),
        limit: this.coercePresetLimit(filters.limit)
      }
    };
  }

  private coercePresetIncludeTestOrders(value: unknown): boolean {
    return typeof value === 'boolean' ? value : true;
  }

  private coercePresetLimit(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 20;
  }

  private coercePresetSlaFilter(value: unknown): SlaFilter {
    const raw = typeof value === 'string' ? value : 'all';
    return PRESET_SLA_FILTERS.has(raw as SlaFilter) ? (raw as SlaFilter) : 'all';
  }

  private coercePresetFraudFilter(value: unknown): FraudFilter {
    const raw = typeof value === 'string' ? value : 'all';
    return PRESET_FRAUD_FILTERS.has(raw as FraudFilter) ? (raw as FraudFilter) : 'all';
  }

  private persistPresets(): void {
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(this.presets));
    } catch {
      // ignore
    }
  }

  private persistExportState(): void {
    try {
      localStorage.setItem(
        this.exportStorageKey(),
        JSON.stringify({
          templates: this.exportTemplates,
          selectedTemplateId: this.selectedExportTemplateId,
          columns: this.selectedExportColumns()
        })
      );
    } catch {
      // ignore
    }
  }
}
