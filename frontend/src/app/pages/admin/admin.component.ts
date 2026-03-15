import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params } from '@angular/router';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { InputComponent } from '../../shared/input.component';
import { HelpPanelComponent } from '../../shared/help-panel.component';
import { ModalComponent } from '../../shared/modal.component';
import { RichEditorComponent } from '../../shared/rich-editor.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { SkeletonComponent } from '../../shared/skeleton.component';
import {
  AdminService,
  AdminSummary,
  AdminProduct,
  AdminOrder,
  AdminUser,
  AdminUserAliasesResponse,
  AdminContent,
  AdminCoupon,
  AdminAudit,
  LowStockItem,
  AdminCategory,
  AdminProductDetail,
  FeaturedCollection,
  ContentBlock,
  ContentImageAssetRead,
  ContentBlockVersionListItem,
  ContentBlockVersionRead,
  ContentPageListItem,
  ContentRedirectRead,
  ContentRedirectImportResult,
  StructuredDataValidationResponse,
  ContentLinkCheckIssue,
  ContentFindReplacePreviewResponse,
  ContentFindReplaceApplyResponse,
  ContentPreviewTokenResponse
} from '../../core/admin.service';
import { AdminBlogComment, BlogService } from '../../core/blog.service';
import { FxAdminService, FxAdminStatus, FxOverrideAuditEntry } from '../../core/fx-admin.service';
import { TaxGroupRead, TaxesAdminService } from '../../core/taxes-admin.service';
import { ToastService } from '../../core/toast.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { combineLatest, firstValueFrom, forkJoin, of, Subscription } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { MarkdownService } from '../../core/markdown.service';
import { AuthService } from '../../core/auth.service';
import { appConfig } from '../../core/app-config';
import { AdminProductListItem, AdminProductsService } from '../../core/admin-products.service';
import { diffLines } from 'diff';
import { formatIdentity } from '../../shared/user-identity';
import { ContentRevisionsComponent } from './shared/content-revisions.component';
import { AssetLibraryComponent } from './shared/asset-library.component';
import { BannerBlockComponent } from '../../shared/banner-block.component';
import { CarouselBlockComponent } from '../../shared/carousel-block.component';
import { CmsEditorPrefsService } from './shared/cms-editor-prefs.service';
import { CmsBlockLibraryBlockType, CmsBlockLibraryComponent, CmsBlockLibraryTemplate } from './shared/cms-block-library.component';
import { LocalizedTextEditorComponent } from './shared/localized-text-editor.component';
import {
  CMS_GLOBAL_SECTIONS,
  CmsGlobalSectionKey,
  cmsGlobalSectionAllowedTypes,
  cmsGlobalSectionDefaultTitle,
  isCmsGlobalSectionKey
} from '../../shared/cms-global-sections';

type AdminContentSection = 'home' | 'pages' | 'blog' | 'settings';
type UiLang = 'en' | 'ro';
type ContentStatusUi = 'draft' | 'review' | 'published';
type LegalPageKey = 'page.terms' | 'page.terms-and-conditions' | 'page.privacy-policy' | 'page.anpc';
const CMS_DRAFT_POLL_INTERVAL_MS = 1200;
const HOME_CUSTOM_CONTENT_BLOCK_TYPE_SET = new Set<HomeCustomContentBlockType>([
  'text',
  'columns',
  'cta',
  'faq',
  'testimonials',
  'image',
  'gallery',
  'banner',
  'carousel'
]);

type HomeSectionId =
  | 'featured_products'
  | 'sale_products'
  | 'new_arrivals'
  | 'featured_collections'
  | 'story'
  | 'recently_viewed'
  | 'why';

type CmsColumnsBreakpoint = 'sm' | 'md' | 'lg';
type CmsProductGridSource = 'category' | 'collection' | 'products';
type CmsFormType = 'contact' | 'newsletter';
type CmsContactTopic = 'contact' | 'support' | 'refund' | 'dispute';

type CmsColumnsColumnDraft = {
  title: LocalizedText;
  body_markdown: LocalizedText;
};

type CmsTestimonialDraft = {
  quote_markdown: LocalizedText;
  author: LocalizedText;
  role: LocalizedText;
};

type CmsFaqItemDraft = {
  question: LocalizedText;
  answer_markdown: LocalizedText;
};

type HomeBlockType =
  | HomeSectionId
  | 'text'
  | 'columns'
  | 'cta'
  | 'faq'
  | 'testimonials'
  | 'product_grid'
  | 'form'
  | 'image'
  | 'gallery'
  | 'banner'
  | 'carousel';

type HomeCustomContentBlockType = 'text' | 'columns' | 'cta' | 'faq' | 'testimonials' | 'image' | 'gallery' | 'banner' | 'carousel';

type LocalizedText = { en: string; ro: string };

type HomeGalleryImageDraft = {
  url: string;
  alt: LocalizedText;
  caption: LocalizedText;
  focal_x: number;
  focal_y: number;
};

type SlideDraft = {
  image_url: string;
  alt: LocalizedText;
  headline: LocalizedText;
  subheadline: LocalizedText;
  cta_label: LocalizedText;
  cta_url: string;
  variant: 'full' | 'split';
  size: 'S' | 'M' | 'L';
  text_style: 'light' | 'dark';
  focal_x: number;
  focal_y: number;
};

type CarouselSettingsDraft = {
  autoplay: boolean;
  interval_ms: number;
  show_dots: boolean;
  show_arrows: boolean;
  pause_on_hover: boolean;
};

type CmsBlockLayoutSpacing = 'none' | 'sm' | 'md' | 'lg';
type CmsBlockLayoutBackground = 'none' | 'muted' | 'accent';
type CmsBlockLayoutAlign = 'left' | 'center';
type CmsBlockLayoutMaxWidth = 'full' | 'narrow' | 'prose' | 'wide';

type CmsBlockLayout = {
  spacing: CmsBlockLayoutSpacing;
  background: CmsBlockLayoutBackground;
  align: CmsBlockLayoutAlign;
  max_width: CmsBlockLayoutMaxWidth;
};

type CmsReusableBlock = {
  id: string;
  title: string;
  block: Omit<PageBlockDraft, 'key'>;
};

type HomeBlockDraft = {
  key: string;
  type: HomeBlockType;
  enabled: boolean;
  title: LocalizedText;
  body_markdown: LocalizedText;
  columns: CmsColumnsColumnDraft[];
  columns_breakpoint: CmsColumnsBreakpoint;
  cta_label: LocalizedText;
  cta_url: string;
  cta_new_tab: boolean;
  faq_items: CmsFaqItemDraft[];
  testimonials: CmsTestimonialDraft[];
  product_grid_source: CmsProductGridSource;
  product_grid_category_slug: string;
  product_grid_collection_slug: string;
  product_grid_product_slugs: string;
  product_grid_limit: number;
  form_type: CmsFormType;
  form_topic: CmsContactTopic;
  url: string;
  link_url: string;
  focal_x: number;
  focal_y: number;
  alt: LocalizedText;
  caption: LocalizedText;
  images: HomeGalleryImageDraft[];
  slide: SlideDraft;
  slides: SlideDraft[];
  settings: CarouselSettingsDraft;
  layout?: CmsBlockLayout;
};

type PageBuilderKey = `page.${string}` | CmsGlobalSectionKey;
type PageBlockType =
  | 'text'
  | 'columns'
  | 'cta'
  | 'faq'
  | 'testimonials'
  | 'product_grid'
  | 'form'
  | 'image'
  | 'gallery'
  | 'banner'
  | 'carousel';
type PageBlockDraft = Omit<HomeBlockDraft, 'type'> & { type: PageBlockType };

type PageBlocksDraftState = {
  blocks: PageBlockDraft[];
  status: ContentStatusUi;
  publishedAt: string;
  publishedUntil: string;
  requiresAuth: boolean;
};

type PageCreationTemplate = 'blank' | 'about' | 'faq' | 'shipping' | 'returns';

type BlogDraftState = {
  title: string;
  body_markdown: string;
  status: ContentStatusUi;
  published_at: string;
  published_until: string;
  summary: string;
  tags: string;
  series: string;
  cover_image_url: string;
  cover_fit: 'cover' | 'contain';
  reading_time_minutes: string;
  pinned: boolean;
  pin_order: string;
};

type CmsPublishChecklistResult = {
  missingTranslations: UiLang[];
  missingAlt: string[];
  emptySections: string[];
  linkIssues: ContentLinkCheckIssue[];
};

type CmsAutosaveEnvelope = {
  v: 1;
  ts: string;
  state_json: string;
};

class CmsDraftManager<T> {
  private initialized = false;
  private past: string[] = [];
  private future: string[] = [];
  private present = '';
  private server = '';
  private restoreCandidate: CmsAutosaveEnvelope | null = null;
  private pending: string | null = null;
  private pendingTimer: number | null = null;
  dirty = false;
  autosavePending = false;
  lastAutosavedAt: string | null = null;

  constructor(
    private readonly storageKey: string,
    private readonly opts: { debounceMs: number; limit: number } = { debounceMs: 650, limit: 60 }
  ) {}

  get hasRestorableAutosave(): boolean {
    return Boolean(this.restoreCandidate?.state_json);
  }

  get restorableAutosaveAt(): string | null {
    return this.restoreCandidate?.ts || null;
  }

  isReady(): boolean {
    return this.initialized;
  }

  initFromServer(state: T): void {
    const serialized = this.serialize(state);
    this.initialized = true;
    this.past = [];
    this.future = [];
    this.present = serialized;
    this.server = serialized;
    this.pending = null;
    this.clearPendingTimer();
    this.dirty = false;
    this.autosavePending = false;
    this.lastAutosavedAt = null;
    this.restoreCandidate = this.readAutosaveCandidate(serialized);
  }

  markServerSaved(state: T, clearAutosave = true): void {
    if (!this.initialized) return;
    this.commitNow(state);
    this.server = this.present;
    this.dirty = false;
    if (clearAutosave) this.clearAutosave();
  }

  observe(state: T): void {
    if (!this.initialized) return;
    const serialized = this.serialize(state);
    this.dirty = serialized !== this.server;
    if (serialized === this.present) return;
    this.pending = serialized;
    this.autosavePending = true;
    this.resetCommitTimer();
  }

  canUndo(current: T): boolean {
    if (!this.initialized) return false;
    const serialized = this.serialize(current);
    return this.past.length > 0 || serialized !== this.present;
  }

  canRedo(current: T): boolean {
    if (!this.initialized) return false;
    const serialized = this.serialize(current);
    if (serialized !== this.present) return false;
    return this.future.length > 0;
  }

  undo(current: T): T | null {
    if (!this.initialized) return null;
    this.commitNow(current);
    if (!this.past.length) return null;
    this.future.push(this.present);
    const prev = this.past.pop()!;
    this.present = prev;
    this.dirty = this.present !== this.server;
    this.writeAutosave(this.present);
    return this.deserialize(prev);
  }

  redo(current: T): T | null {
    if (!this.initialized) return null;
    this.commitNow(current);
    if (!this.future.length) return null;
    this.past.push(this.present);
    const next = this.future.pop()!;
    this.present = next;
    this.dirty = this.present !== this.server;
    this.writeAutosave(this.present);
    return this.deserialize(next);
  }

	  restoreAutosave(current: T): T | null {
	    if (!this.initialized) return null;
	    const candidate = this.restoreCandidate;
	    if (!candidate?.state_json) return null;
	    const restored = candidate.state_json;
	    this.commitNow(current);
	    if (restored === this.present) {
	      this.restoreCandidate = null;
	      return null;
	    }
	    this.past.push(this.present);
	    this.trimPast();
	    this.present = restored;
	    this.lastAutosavedAt = candidate.ts;
    this.dirty = this.present !== this.server;
    this.restoreCandidate = null;
    this.writeAutosave(restored, candidate.ts);
    return this.deserialize(restored);
  }

  discardAutosave(): void {
    this.clearAutosave();
    this.restoreCandidate = null;
  }

  dispose(): void {
    this.clearPendingTimer();
  }

  private commitNow(state: T): void {
    const serialized = this.serialize(state);
    this.clearPendingTimer();
    this.pending = null;
    this.autosavePending = false;
    this.dirty = serialized !== this.server;
    if (serialized === this.present) return;
    if (this.present) {
      this.past.push(this.present);
      this.trimPast();
    }
    this.present = serialized;
    this.future = [];
    this.writeAutosave(serialized);
  }

  private resetCommitTimer(): void {
    this.clearPendingTimer();
    this.pendingTimer = window.setTimeout(() => this.commitPending(), this.opts.debounceMs);
  }

  private commitPending(): void {
    if (!this.pending) {
      this.autosavePending = false;
      return;
    }
    const next = this.pending;
    this.pending = null;
    this.pendingTimer = null;
    this.autosavePending = false;
    if (next === this.present) return;
    if (this.present) {
      this.past.push(this.present);
      this.trimPast();
    }
    this.present = next;
    this.future = [];
    this.dirty = this.present !== this.server;
    this.writeAutosave(next);
  }

  private trimPast(): void {
    if (this.past.length <= this.opts.limit) return;
    this.past.splice(0, this.past.length - this.opts.limit);
  }

  private clearPendingTimer(): void {
    if (this.pendingTimer !== null) {
      window.clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private serialize(state: T): string {
    return JSON.stringify(state);
  }

  private deserialize(raw: string): T {
    return JSON.parse(raw) as T;
  }

  private writeAutosave(stateJson: string, tsOverride?: string): void {
    if (typeof window === 'undefined') return;
    const ts = tsOverride || new Date().toISOString();
    this.lastAutosavedAt = ts;
    try {
      const payload: CmsAutosaveEnvelope = { v: 1, ts, state_json: stateJson };
      window.localStorage.setItem(this.storageKey, JSON.stringify(payload));
    } catch {
      // ignore quota / browser storage errors
    }
  }

  private clearAutosave(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(this.storageKey);
    } catch {
      // ignore
    }
    this.lastAutosavedAt = null;
  }

  private readAutosaveCandidate(serverStateJson: string): CmsAutosaveEnvelope | null {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(this.storageKey);
    if (!raw) return null;
    const candidate = this.parseAutosaveEnvelope(raw);
    if (!candidate) return null;
    if (candidate.state_json === serverStateJson) {
      window.localStorage.removeItem(this.storageKey);
      return null;
    }
    return candidate;
  }

  private parseAutosaveEnvelope(raw: string): CmsAutosaveEnvelope | null {
    try {
      const parsed: Partial<CmsAutosaveEnvelope> | null = JSON.parse(raw);
      if (!parsed || parsed.v !== 1) return null;
      const ts = typeof parsed.ts === 'string' ? parsed.ts : '';
      const stateJson = typeof parsed.state_json === 'string' ? parsed.state_json : '';
      if (!ts || !stateJson) return null;
      return { v: 1, ts, state_json: stateJson };
    } catch {
      return null;
    }
  }
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    BreadcrumbComponent,
    ButtonComponent,
    ErrorStateComponent,
    InputComponent,
    HelpPanelComponent,
    ModalComponent,
    RichEditorComponent,
    LocalizedCurrencyPipe,
    SkeletonComponent,
    ContentRevisionsComponent,
    AssetLibraryComponent,
    CmsBlockLibraryComponent,
    BannerBlockComponent,
    CarouselBlockComponent,
    LocalizedTextEditorComponent,
    TranslateModule
  ],
  templateUrl: './admin.component.html',})
export class AdminComponent implements OnInit, OnDestroy {
  crumbs = [
    { label: 'adminUi.nav.content', url: '/admin/content' },
    { label: 'adminUi.content.nav.home' }
  ];

  section = signal<AdminContentSection>('home');

  private readonly contentVersions: Record<string, number> = {};
  private routeSub?: Subscription;

  pagesRevisionKey = 'page.about';
  homeRevisionKey = 'home.sections';
  settingsRevisionKey = 'site.assets';

  summary = signal<AdminSummary | null>(null);
  loading = signal<boolean>(true);
  error = signal<string | null>(null);
  errorRequestId = signal<string | null>(null);

  products: AdminProduct[] = [];
  categories: AdminCategory[] = [];
  categoryName = '';
  categoryParentId = '';
  categoryWizardOpen = signal(false);
  categoryWizardStep = signal(0);
  categoryWizardSlug = signal<string | null>(null);
  readonly categoryWizardSteps = [
    {
      id: 'basics',
      labelKey: 'adminUi.categories.wizard.steps.basics',
      descriptionKey: 'adminUi.categories.wizard.desc.basics'
    },
    {
      id: 'translations',
      labelKey: 'adminUi.categories.wizard.steps.translations',
      descriptionKey: 'adminUi.categories.wizard.desc.translations'
    }
  ];
  categoryTranslationsSlug: string | null = null;
  categoryTranslationsError = signal<string | null>(null);
  categoryTranslationExists: Record<'en' | 'ro', boolean> = { en: false, ro: false };
  categoryTranslations: Record<'en' | 'ro', { name: string; description: string }> = {
    en: this.blankCategoryTranslation(),
    ro: this.blankCategoryTranslation()
  };
  categoryDeleteConfirmOpen = signal(false);
  categoryDeleteConfirmBusy = signal(false);
  categoryDeleteConfirmTarget = signal<AdminCategory | null>(null);
  taxGroups: TaxGroupRead[] = [];
  taxGroupsLoading = false;
  taxGroupsError: string | null = null;
  taxGroupCreate = { code: '', name: '', description: '', is_default: false };
  taxRateCountry: Record<string, string> = {};
  taxRatePercent: Record<string, string> = {};
  maintenanceEnabledValue = false;
  maintenanceEnabled = signal<boolean>(false);
  draggingSlug: string | null = null;
  selectedIds = new Set<string>();
  allSelected = false;
  homeBlocksLang: UiLang = 'en';
  newHomeBlockType: 'text' | 'columns' | 'cta' | 'faq' | 'testimonials' | 'image' | 'gallery' | 'banner' | 'carousel' = 'text';
  homeBlocks: HomeBlockDraft[] = [];
  draggingHomeBlockKey: string | null = null;
  homeInsertDragActive = false;
  sectionsMessage = '';

  productGridProductSearchQuery: Record<string, string> = {};
  productGridProductSearchResults: Record<string, AdminProductListItem[]> = {};
  productGridProductSearchLoading: Record<string, boolean> = {};
  productGridProductSearchError: Record<string, string | null> = {};
  private productGridProductSearchTimers: Record<string, number> = {};

  featuredCollections: FeaturedCollection[] = [];
  collectionForm: { name: string; description?: string | null; product_ids: string[] } = {
    name: '',
    description: '',
    product_ids: []
  };
  editingCollection: string | null = null;
  collectionMessage = '';

  formMessage = '';
  editingId: string | null = null;
  productDetail: AdminProductDetail | null = null;
  productImages = signal<{ id: string; url: string; alt_text?: string | null }[]>([]);
  form = {
    name: '',
    slug: '',
    category_id: '',
    price: 0,
    stock: 0,
    status: 'draft',
    sku: '',
    image: '',
    description: '',
    publish_at: '',
    is_bestseller: false
  };

  orders: AdminOrder[] = [];
  activeOrder: AdminOrder | null = null;
  orderFilter = '';

  users: AdminUser[] = [];
  selectedUserId: string | null = null;
  selectedUserRole: string | null = null;
  userAliases: AdminUserAliasesResponse | null = null;
  userAliasesLoading = false;
  userAliasesError: string | null = null;

  contentBlocks: AdminContent[] = [];
  selectedContent: AdminContent | null = null;
  contentForm = {
    title: '',
    body_markdown: '',
    status: 'draft'
  };
  showContentPreview = false;

	  showBlogCreate = false;
	  blogCreate: {
	    baseLang: 'en' | 'ro';
	    status: ContentStatusUi;
	    published_at: string;
	    published_until: string;
	    title: string;
    body_markdown: string;
    summary: string;
	    tags: string;
	    series: string;
	    cover_image_url: string;
	    reading_time_minutes: string;
	    pinned: boolean;
	    pin_order: string;
	    includeTranslation: boolean;
	    translationTitle: string;
	    translationBody: string;
	  } = {
	    baseLang: 'en',
	    status: 'draft',
	    published_at: '',
	    published_until: '',
	    title: '',
    body_markdown: '',
	    summary: '',
	    tags: '',
	    series: '',
	    cover_image_url: '',
	    reading_time_minutes: '',
	    pinned: false,
	    pin_order: '1',
    includeTranslation: false,
    translationTitle: '',
    translationBody: ''
  };
  selectedBlogKey: string | null = null;
  blogBaseLang: 'en' | 'ro' = 'en';
  blogEditLang: 'en' | 'ro' = 'en';
  blogForm = {
    title: '',
    body_markdown: '',
    status: 'draft',
    published_at: '',
    published_until: '',
	    summary: '',
	    tags: '',
	    series: '',
	    cover_image_url: '',
      cover_fit: 'cover' as 'cover' | 'contain',
	    reading_time_minutes: '',
	    pinned: false,
	    pin_order: '1'
	  };
  blogMeta: Record<string, any> = {};
  blogImages: { id: string; url: string; alt_text?: string | null; sort_order: number; focal_x: number; focal_y: number }[] = [];
  blogBulkSelection = new Set<string>();
  blogDeleteBusy = new Set<string>();
  blogBulkAction: 'publish' | 'unpublish' | 'schedule' | 'tags_add' | 'tags_remove' = 'publish';
  blogBulkPublishAt = '';
  blogBulkUnpublishAt = '';
  blogBulkTags = '';
  blogBulkSaving = false;
  blogBulkError = '';
  blogPinsSaving = false;
  draggingBlogPinKey: string | null = null;
  showBlogCoverLibrary = false;
  showBlogPreview = false;
  blogA11yOpen = false;
  blogSeoSnapshots: Record<UiLang, { title: string; body_markdown: string } | null> = { en: null, ro: null };
  blogSeoSnapshotsKey: string | null = null;
  blogSeoSnapshotsLoading = false;
  useRichBlogEditor = true;
  blogImageLayout: 'default' | 'wide' | 'left' | 'right' | 'gallery' = 'default';
  blogSocialLangs: UiLang[] = ['en', 'ro'];
  blogPreviewUrl: string | null = null;
  blogPreviewToken: string | null = null;
  blogPreviewExpiresAt: string | null = null;
  blogVersions: ContentBlockVersionListItem[] = [];
  blogVersionDetail: ContentBlockVersionRead | null = null;
  blogDiffParts: { value: string; added?: boolean; removed?: boolean }[] = [];
  blogCommentModerationBusy = new Set<string>();
  flaggedComments = signal<AdminBlogComment[]>([]);
  flaggedCommentsLoading = signal<boolean>(false);
  flaggedCommentsError: string | null = null;

  assetsForm = { logo_url: '', favicon_url: '', social_image_url: '' };
  assetsMessage: string | null = null;
  assetsError: string | null = null;
  socialForm: {
    phone: string;
    email: string;
    instagram_pages: Array<{ label: string; url: string; thumbnail_url: string }>;
    facebook_pages: Array<{ label: string; url: string; thumbnail_url: string }>;
  } = {
    phone: '+40723204204',
    email: 'momentstudio.ro@gmail.com',
    instagram_pages: [
      { label: 'Moments in Clay - Studio', url: 'https://www.instagram.com/moments_in_clay_studio?igsh=ZmdnZTdudnNieDQx', thumbnail_url: '' },
      { label: 'momentstudio', url: 'https://www.instagram.com/adrianaartizanat?igsh=ZmZmaDU1MGcxZHEy', thumbnail_url: '' }
    ],
    facebook_pages: [
      { label: 'Moments in Clay - Studio', url: 'https://www.facebook.com/share/17YqBmfX5x/', thumbnail_url: '' },
      { label: 'momentstudio', url: 'https://www.facebook.com/share/1APqKJM6Zi/', thumbnail_url: '' }
    ]
  };
  socialMessage: string | null = null;
  socialError: string | null = null;
  socialThumbLoading: Record<string, boolean> = {};
  socialThumbErrors: Record<string, string> = {};
  navigationForm: {
    header_links: Array<{ id: string; url: string; label: LocalizedText }>;
    footer_handcrafted_links: Array<{ id: string; url: string; label: LocalizedText }>;
    footer_legal_links: Array<{ id: string; url: string; label: LocalizedText }>;
  } = this.defaultNavigationForm();
  navigationMessage: string | null = null;
  navigationError: string | null = null;
  private draggingNavList: 'header' | 'footer_handcrafted' | 'footer_legal' | null = null;
  private draggingNavId: string | null = null;
  companyForm: {
    name: string;
    registration_number: string;
    cui: string;
    address: string;
    phone: string;
    email: string;
  } = {
    name: '',
    registration_number: '',
    cui: '',
    address: '',
    phone: '',
    email: ''
  };
  companyMessage: string | null = null;
  companyError: string | null = null;
	  checkoutSettingsForm: {
	    shipping_fee_ron: number | string;
	    free_shipping_threshold_ron: number | string;
	    phone_required_home: boolean;
	    phone_required_locker: boolean;
	    fee_enabled: boolean;
	    fee_type: 'flat' | 'percent';
	    fee_value: number | string;
	    vat_enabled: boolean;
	    vat_rate_percent: number | string;
	    vat_apply_to_shipping: boolean;
	    vat_apply_to_fee: boolean;
	    receipt_share_days: number | string;
	    money_rounding: 'half_up' | 'half_even' | 'up' | 'down';
	  } = {
	    shipping_fee_ron: 20,
	    free_shipping_threshold_ron: 300,
	    phone_required_home: true,
	    phone_required_locker: true,
	    fee_enabled: false,
	    fee_type: 'flat',
	    fee_value: 0,
	    vat_enabled: true,
	    vat_rate_percent: 10,
	    vat_apply_to_shipping: false,
	    vat_apply_to_fee: false,
	    receipt_share_days: 365,
	    money_rounding: 'half_up'
	  };
  checkoutSettingsMessage: string | null = null;
  checkoutSettingsError: string | null = null;
  reportsSettingsMeta: Record<string, any> = {};
  reportsSettingsForm: {
    weekly_enabled: boolean;
    weekly_weekday: number;
    weekly_hour_utc: number;
    monthly_enabled: boolean;
    monthly_day: number | string;
    monthly_hour_utc: number;
    recipients: string;
  } = {
    weekly_enabled: false,
    weekly_weekday: 0,
    weekly_hour_utc: 8,
    monthly_enabled: false,
    monthly_day: 1,
    monthly_hour_utc: 8,
    recipients: ''
  };
  reportsWeeklyLastSent: string | null = null;
  reportsWeeklyLastError: string | null = null;
  reportsMonthlyLastSent: string | null = null;
  reportsMonthlyLastError: string | null = null;
  reportsSettingsMessage: string | null = null;
  reportsSettingsError: string | null = null;
  reportsSending = false;
  readonly reportsWeekdays = [
    { value: 0, labelKey: 'adminUi.reports.weekdays.mon' },
    { value: 1, labelKey: 'adminUi.reports.weekdays.tue' },
    { value: 2, labelKey: 'adminUi.reports.weekdays.wed' },
    { value: 3, labelKey: 'adminUi.reports.weekdays.thu' },
    { value: 4, labelKey: 'adminUi.reports.weekdays.fri' },
    { value: 5, labelKey: 'adminUi.reports.weekdays.sat' },
    { value: 6, labelKey: 'adminUi.reports.weekdays.sun' }
  ];
  readonly reportsHours = Array.from({ length: 24 }, (_, hour) => hour);
  seoLang: 'en' | 'ro' = 'en';
  seoPage: 'home' | 'shop' | 'product' | 'category' | 'about' = 'home';
  seoForm = { title: '', description: '' };
  seoMessage: string | null = null;
  seoError: string | null = null;
  sitemapPreviewLoading = false;
  sitemapPreviewError: string | null = null;
  sitemapPreviewByLang: Record<string, string[]> | null = null;
  structuredDataLoading = false;
  structuredDataError: string | null = null;
  structuredDataResult: StructuredDataValidationResponse | null = null;
  infoLang: UiLang = 'en';
  infoForm: { about: LocalizedText; faq: LocalizedText; shipping: LocalizedText; contact: LocalizedText } = {
    about: { en: '', ro: '' },
    faq: { en: '', ro: '' },
    shipping: { en: '', ro: '' },
    contact: { en: '', ro: '' }
  };
  infoMessage: string | null = null;
  infoError: string | null = null;
  legalPageKey: LegalPageKey = 'page.terms';
  legalPageForm: LocalizedText = { en: '', ro: '' };
  legalPageLastUpdated = '';
  private legalPageLastUpdatedOriginal = '';
  private legalPageMeta: Record<string, unknown> = {};
  legalPageLoading = false;
  legalPageSaving = false;
  legalPageMessage: string | null = null;
  legalPageError: string | null = null;
  contentPages: ContentPageListItem[] = [];
  contentPagesLoading = false;
  contentPagesError: string | null = null;
  showHiddenPages = false;
  pageVisibilitySaving: Record<string, boolean> = {};
  reusableBlocks: CmsReusableBlock[] = [];
  reusableBlocksLoading = false;
  reusableBlocksError: string | null = null;
  reusableBlocksQuery = '';
  private reusableBlocksMeta: Record<string, unknown> = {};
  private readonly reusableBlocksKey = 'cms.snippets';
  private reusableBlocksExists = false;
  redirects: ContentRedirectRead[] = [];
  redirectsMeta = { total_items: 0, total_pages: 1, page: 1, limit: 25 };
  redirectsLoading = false;
  redirectsError: string | null = null;
  redirectsQuery = '';
  redirectsExporting = false;
  redirectsImporting = false;
  redirectsImportResult: ContentRedirectImportResult | null = null;
  redirectCreateFrom = '';
  redirectCreateTo = '';
  redirectCreateSaving = false;
  findReplaceFind = '';
  findReplaceReplace = '';
  findReplaceScope: 'all' | 'pages' | 'blog' | 'home' | 'site' = 'pages';
  findReplaceCaseSensitive = true;
  findReplaceLoading = false;
  findReplaceApplying = false;
  findReplaceError: string | null = null;
  findReplacePreview: ContentFindReplacePreviewResponse | null = null;
  findReplaceApplyResult: ContentFindReplaceApplyResponse | null = null;
  private findReplacePreviewKey: string | null = null;
  linkCheckKey = 'page.about';
  linkCheckLoading = false;
  linkCheckError: string | null = null;
  linkCheckIssues: ContentLinkCheckIssue[] = [];
  newCustomPageTitle = '';
  newCustomPageTemplate: PageCreationTemplate = 'blank';
  newCustomPageStatus: ContentStatusUi = 'draft';
  newCustomPagePublishedAt = '';
  newCustomPagePublishedUntil = '';
  creatingCustomPage = false;
  readonly globalSections = CMS_GLOBAL_SECTIONS;
  readonly allPageBlockTypes: PageBlockType[] = [
    'text',
    'columns',
    'cta',
    'faq',
    'testimonials',
    'product_grid',
    'form',
    'image',
    'gallery',
    'banner',
    'carousel'
  ];
  readonly homeCmsLibraryTypes: ReadonlyArray<CmsBlockLibraryBlockType> = [
    'text',
    'columns',
    'cta',
    'faq',
    'testimonials',
    'image',
    'gallery',
    'banner',
    'carousel'
  ];
  pageBlocksKey: PageBuilderKey = 'page.about';
  newPageBlockType: PageBlockType = 'text';
  pageBlocks: Record<string, PageBlockDraft[]> = {};
  pageBlocksMeta: Record<string, Record<string, unknown>> = {};
  pageBlocksRequiresAuth: Record<string, boolean> = {};
  pageBlocksStatus: Record<string, ContentStatusUi> = {};
  pageBlocksPublishedAt: Record<string, string> = {};
  pageBlocksPublishedUntil: Record<string, string> = {};
  pageBlocksMessage: Record<string, string | null> = {};
  pageBlocksError: Record<string, string | null> = {};
  pageBlocksNeedsTranslationEn: Record<string, boolean> = {};
	  pageBlocksNeedsTranslationRo: Record<string, boolean> = {};
	  pageBlocksTranslationSaving: Record<string, boolean> = {};

  pagePreviewForSlug: string | null = null;
  pagePreviewToken: string | null = null;
  private pagePreviewOrigin: string | null = null;
  pagePreviewExpiresAt: string | null = null;
  private pagePreviewNonce = 0;

  homePreviewToken: string | null = null;
  private homePreviewOrigin: string | null = null;
  homePreviewExpiresAt: string | null = null;
  private homePreviewNonce = 0;

    pagePublishChecklistOpen = false;
    pagePublishChecklistLoading = false;
    pagePublishChecklistError: string | null = null;
    pagePublishChecklistKey: PageBuilderKey | null = null;
    pagePublishChecklistResult: CmsPublishChecklistResult | null = null;
	  draggingPageBlockKey: string | null = null;
	  draggingPageBlocksKey: string | null = null;
	  pageInsertDragActive = false;
	  cmsAriaAnnouncement = '';
	  private cmsDraftPoller: number | null = null;
	  private readonly cmsHomeDraft = new CmsDraftManager<HomeBlockDraft[]>('adrianaart.cms.autosave.home.sections');
	  private readonly cmsPageDrafts = new Map<string, CmsDraftManager<PageBlocksDraftState>>();
	  private readonly cmsBlogDrafts = new Map<string, CmsDraftManager<BlogDraftState>>();
	  coupons: AdminCoupon[] = [];
	  newCoupon: Partial<AdminCoupon> = { code: '', percentage_off: 0, active: true, currency: 'RON' };
	  stockEdits: Record<string, number> = {};
	  bulkStock: number | null = null;

  fxStatus = signal<FxAdminStatus | null>(null);
  fxLoading = signal<boolean>(false);
  fxError = signal<string | null>(null);
  fxOverrideForm: { eur_per_ron: number; usd_per_ron: number; as_of: string } = { eur_per_ron: 0, usd_per_ron: 0, as_of: '' };
  fxAudit = signal<FxOverrideAuditEntry[]>([]);
  fxAuditLoading = signal(false);
  fxAuditError = signal<string | null>(null);
  fxAuditRestoring = signal<string | null>(null);

  productAudit: AdminAudit['products'] = [];
  contentAudit: AdminAudit['content'] = [];
  securityAudit: NonNullable<AdminAudit['security']> = [];
  lowStock: LowStockItem[] = [];

  ownerTransferIdentifier = '';
  ownerTransferConfirm = '';
  ownerTransferLoading = false;
  ownerTransferError: string | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly admin: AdminService,
    private readonly adminProducts: AdminProductsService,
    private readonly blog: BlogService,
    private readonly fxAdmin: FxAdminService,
    private readonly taxesAdmin: TaxesAdminService,
    private readonly auth: AuthService,
    public readonly cmsPrefs: CmsEditorPrefsService,
    private readonly toast: ToastService,
    private readonly translate: TranslateService,
    private readonly markdown: MarkdownService,
    private readonly sanitizer: DomSanitizer
  ) {}

	  private t(key: string, params?: Record<string, unknown>): string {
	    return this.translate.instant(key, params);
	  }

	  private announceCms(message: string): void {
	    this.cmsAriaAnnouncement = '';
	    window.setTimeout(() => {
	      this.cmsAriaAnnouncement = message;
	    }, 10);
	  }

	  private observeCmsDrafts(): void {
	    if (this.cmsHomeDraft.isReady()) {
	      this.cmsHomeDraft.observe(this.homeBlocks);
	    }

	    const pageKey = this.pageBlocksKey;
	    const pageDraft = this.ensurePageDraft(pageKey);
	    if (pageDraft.isReady()) {
	      pageDraft.observe(this.currentPageDraftState(pageKey));
	    }

	    const blogKey = this.selectedBlogKey;
	    if (blogKey) {
	      const id = this.blogDraftId(blogKey, this.blogEditLang);
	      const manager = this.cmsBlogDrafts.get(id);
	      if (manager?.isReady()) {
	        manager.observe(this.currentBlogDraftState());
	      }
	    }
	  }

	  private ensurePageDraft(pageKey: PageBuilderKey): CmsDraftManager<PageBlocksDraftState> {
	    const existing = this.cmsPageDrafts.get(pageKey);
	    if (existing) return existing;
	    const created = new CmsDraftManager<PageBlocksDraftState>(`adrianaart.cms.autosave.${pageKey}`);
	    this.cmsPageDrafts.set(pageKey, created);
	    return created;
	  }

  private currentPageDraftState(pageKey: PageBuilderKey): PageBlocksDraftState {
    const safePageKey = this.safePageRecordKey(pageKey);
    return {
      blocks: this.pageBlocks[safePageKey] || [],
      status: this.pageBlocksStatus[safePageKey] || 'draft',
      publishedAt: this.pageBlocksPublishedAt[safePageKey] || '',
      publishedUntil: this.pageBlocksPublishedUntil[safePageKey] || '',
      requiresAuth: Boolean(this.pageBlocksRequiresAuth[safePageKey])
    };
  }

    private normalizePageBlockDraft(block: PageBlockDraft): PageBlockDraft {
      return { ...block, layout: this.toCmsBlockLayout(block.layout) };
    }

  private applyPageDraftState(pageKey: PageBuilderKey, draft: PageBlocksDraftState): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    this.pageBlocks[safePageKey] = Array.isArray(draft?.blocks) ? draft.blocks.map((b) => this.normalizePageBlockDraft(b)) : [];
    this.pageBlocksStatus[safePageKey] = draft?.status === 'published' ? 'published' : draft?.status === 'review' ? 'review' : 'draft';
    this.pageBlocksPublishedAt[safePageKey] = draft?.publishedAt || '';
    this.pageBlocksPublishedUntil[safePageKey] = draft?.publishedUntil || '';
    this.pageBlocksRequiresAuth[safePageKey] = Boolean(draft?.requiresAuth);
  }

	  private blogDraftId(key: string, lang: UiLang): string {
	    return `${key}.${lang}`;
	  }

	  private ensureBlogDraft(key: string, lang: UiLang): CmsDraftManager<BlogDraftState> {
	    const id = this.blogDraftId(key, lang);
	    const existing = this.cmsBlogDrafts.get(id);
	    if (existing) return existing;
	    const created = new CmsDraftManager<BlogDraftState>(`adrianaart.cms.autosave.${id}`);
	    this.cmsBlogDrafts.set(id, created);
	    return created;
	  }

	  private currentBlogDraftState(): BlogDraftState {
	    return {
	      title: this.blogForm.title,
	      body_markdown: this.blogForm.body_markdown,
	      status:
	        this.blogForm.status === 'published'
	          ? 'published'
	          : this.blogForm.status === 'review'
	            ? 'review'
	            : 'draft',
	      published_at: this.blogForm.published_at,
	      published_until: this.blogForm.published_until,
	      summary: this.blogForm.summary,
	      tags: this.blogForm.tags,
	      series: this.blogForm.series,
	      cover_image_url: this.blogForm.cover_image_url,
        cover_fit: this.blogForm.cover_fit,
	      reading_time_minutes: this.blogForm.reading_time_minutes,
	      pinned: Boolean(this.blogForm.pinned),
	      pin_order: this.blogForm.pin_order
	    };
	  }

	  private applyBlogDraftState(draft: BlogDraftState): void {
	    this.blogForm = {
	      ...this.blogForm,
	      ...draft
	    };
	  }

	  blogDraftReady(): boolean {
	    if (!this.selectedBlogKey) return false;
	    const id = this.blogDraftId(this.selectedBlogKey, this.blogEditLang);
	    const manager = this.cmsBlogDrafts.get(id);
	    return manager?.isReady() ?? false;
	  }

	  blogDraftDirty(): boolean {
	    if (!this.selectedBlogKey) return false;
	    const id = this.blogDraftId(this.selectedBlogKey, this.blogEditLang);
	    return this.cmsBlogDrafts.get(id)?.dirty ?? false;
	  }

	  blogDraftAutosaving(): boolean {
	    if (!this.selectedBlogKey) return false;
	    const id = this.blogDraftId(this.selectedBlogKey, this.blogEditLang);
	    return this.cmsBlogDrafts.get(id)?.autosavePending ?? false;
	  }

	  blogDraftLastAutosavedAt(): string | null {
	    if (!this.selectedBlogKey) return null;
	    const id = this.blogDraftId(this.selectedBlogKey, this.blogEditLang);
	    return this.cmsBlogDrafts.get(id)?.lastAutosavedAt ?? null;
	  }

	  blogDraftHasRestore(): boolean {
	    if (!this.selectedBlogKey) return false;
	    const manager = this.ensureBlogDraft(this.selectedBlogKey, this.blogEditLang);
	    return manager.hasRestorableAutosave && !manager.dirty;
	  }

	  blogDraftRestoreAt(): string | null {
	    if (!this.selectedBlogKey) return null;
	    const manager = this.ensureBlogDraft(this.selectedBlogKey, this.blogEditLang);
	    return manager.restorableAutosaveAt;
	  }

	  restoreBlogDraftAutosave(): void {
	    if (!this.selectedBlogKey) return;
	    const manager = this.ensureBlogDraft(this.selectedBlogKey, this.blogEditLang);
	    const next = manager.restoreAutosave(this.currentBlogDraftState());
	    if (next) this.applyBlogDraftState(next);
	  }

	  dismissBlogDraftAutosave(): void {
	    if (!this.selectedBlogKey) return;
	    const manager = this.ensureBlogDraft(this.selectedBlogKey, this.blogEditLang);
	    manager.discardAutosave();
	  }

	  homeDraftReady(): boolean {
	    return this.cmsHomeDraft.isReady();
	  }

	  homeDraftDirty(): boolean {
	    return this.cmsHomeDraft.dirty;
	  }

	  homeDraftAutosaving(): boolean {
	    return this.cmsHomeDraft.autosavePending;
	  }

	  homeDraftLastAutosavedAt(): string | null {
	    return this.cmsHomeDraft.lastAutosavedAt;
	  }

	  homeDraftHasRestore(): boolean {
	    return this.cmsHomeDraft.hasRestorableAutosave && !this.cmsHomeDraft.dirty;
	  }

	  homeDraftRestoreAt(): string | null {
	    return this.cmsHomeDraft.restorableAutosaveAt;
	  }

	  homeDraftCanUndo(): boolean {
	    return this.cmsHomeDraft.canUndo(this.homeBlocks);
	  }

	  homeDraftCanRedo(): boolean {
	    return this.cmsHomeDraft.canRedo(this.homeBlocks);
	  }

	  undoHomeDraft(): void {
	    const next = this.cmsHomeDraft.undo(this.homeBlocks);
	    if (next) this.homeBlocks = next;
	  }

	  redoHomeDraft(): void {
	    const next = this.cmsHomeDraft.redo(this.homeBlocks);
	    if (next) this.homeBlocks = next;
	  }

	  restoreHomeDraftAutosave(): void {
	    const next = this.cmsHomeDraft.restoreAutosave(this.homeBlocks);
	    if (next) this.homeBlocks = next;
	  }

	  dismissHomeDraftAutosave(): void {
	    this.cmsHomeDraft.discardAutosave();
	  }

	  pageDraftReady(pageKey: PageBuilderKey): boolean {
	    return this.ensurePageDraft(pageKey).isReady();
	  }

	  pageDraftDirty(pageKey: PageBuilderKey): boolean {
	    return this.ensurePageDraft(pageKey).dirty;
	  }

	  pageDraftAutosaving(pageKey: PageBuilderKey): boolean {
	    return this.ensurePageDraft(pageKey).autosavePending;
	  }

	  pageDraftLastAutosavedAt(pageKey: PageBuilderKey): string | null {
	    return this.ensurePageDraft(pageKey).lastAutosavedAt;
	  }

	  pageDraftHasRestore(pageKey: PageBuilderKey): boolean {
	    const manager = this.ensurePageDraft(pageKey);
	    return manager.hasRestorableAutosave && !manager.dirty;
	  }

	  pageDraftRestoreAt(pageKey: PageBuilderKey): string | null {
	    return this.ensurePageDraft(pageKey).restorableAutosaveAt;
	  }

	  pageDraftCanUndo(pageKey: PageBuilderKey): boolean {
	    const manager = this.ensurePageDraft(pageKey);
	    return manager.canUndo(this.currentPageDraftState(pageKey));
	  }

	  pageDraftCanRedo(pageKey: PageBuilderKey): boolean {
	    const manager = this.ensurePageDraft(pageKey);
	    return manager.canRedo(this.currentPageDraftState(pageKey));
	  }

	  undoPageDraft(pageKey: PageBuilderKey): void {
	    const manager = this.ensurePageDraft(pageKey);
	    const next = manager.undo(this.currentPageDraftState(pageKey));
	    if (next) this.applyPageDraftState(pageKey, next);
	  }

	  redoPageDraft(pageKey: PageBuilderKey): void {
	    const manager = this.ensurePageDraft(pageKey);
	    const next = manager.redo(this.currentPageDraftState(pageKey));
	    if (next) this.applyPageDraftState(pageKey, next);
	  }

	  restorePageDraftAutosave(pageKey: PageBuilderKey): void {
	    const manager = this.ensurePageDraft(pageKey);
	    const next = manager.restoreAutosave(this.currentPageDraftState(pageKey));
	    if (next) this.applyPageDraftState(pageKey, next);
	  }

	  dismissPageDraftAutosave(pageKey: PageBuilderKey): void {
	    this.ensurePageDraft(pageKey).discardAutosave();
	  }

  private rememberContentVersion(key: string, block: { version?: number } | null | undefined): void {
    const safeKey = this.safeRecordKey(key);
    const version = block?.version;
    if (typeof version === 'number' && Number.isFinite(version) && version > 0) {
      this.setRecordValue(this.contentVersions, safeKey, version);
    }
  }

  private expectedVersion(key: string): number | undefined {
    const safeKey = this.safeRecordKey(key);
    const version = this.contentVersions[safeKey];
    return typeof version === 'number' && Number.isFinite(version) && version > 0 ? version : undefined;
  }

  private withExpectedVersion<T extends Record<string, unknown>>(key: string, payload: T): T & { expected_version?: number } {
    const expected = this.expectedVersion(key);
    return expected ? { ...payload, expected_version: expected } : payload;
  }

  private handleContentConflict(err: any, key: string, reload: () => void): boolean {
    if (err?.status !== 409) return false;
    const safeKey = this.safeRecordKey(key);
    this.toast.error(this.t('adminUi.content.errors.conflictTitle'), this.t('adminUi.content.errors.conflictCopy'));
    this.deleteRecordValue(this.contentVersions, safeKey);
    reload();
    return true;
  }

  pagesRevisionTitleKey(): string | undefined {
    switch (String(this.pagesRevisionKey || '').trim()) {
      case 'page.about':
        return 'adminUi.site.pages.aboutLabel';
      case 'page.contact':
        return 'adminUi.site.pages.contactLabel';
      case 'page.terms':
        return 'adminUi.site.pages.legal.documents.termsIndex';
      case 'page.terms-and-conditions':
        return 'adminUi.site.pages.legal.documents.terms';
      case 'page.privacy-policy':
        return 'adminUi.site.pages.legal.documents.privacy';
      case 'page.anpc':
        return 'adminUi.site.pages.legal.documents.anpc';
      default:
        return undefined;
    }
  }

  homeRevisionTitleKey(): string {
    switch (this.homeRevisionKey) {
      case 'home.sections':
        return 'adminUi.home.sections.title';
      case 'home.story':
        return 'adminUi.home.story.title';
      default:
        return 'adminUi.content.revisions.title';
    }
  }

  settingsRevisionTitleKey(): string {
    if ((this.settingsRevisionKey || '').startsWith('seo.')) {
      return 'adminUi.site.seo.title';
    }
    switch (this.settingsRevisionKey) {
      case 'site.assets':
        return 'adminUi.site.assets.title';
      case 'site.social':
        return 'adminUi.site.social.title';
      case 'site.company':
        return 'adminUi.site.company.title';
      case 'site.navigation':
        return 'adminUi.site.navigation.title';
      case 'site.checkout':
        return 'adminUi.site.checkout.title';
      case 'site.reports':
        return 'adminUi.reports.title';
      default:
        return 'adminUi.content.revisions.title';
    }
  }

  isOwner(): boolean {
    return this.auth.role() === 'owner';
  }

  cmsAdvanced(): boolean {
    return this.cmsPrefs.mode() === 'advanced';
  }

  cmsPreviewMaxWidthClass(): string {
    switch (this.cmsPrefs.previewDevice()) {
      case 'mobile':
        return 'max-w-[390px]';
      case 'tablet':
        return 'max-w-[768px]';
      default:
        return 'max-w-[1024px]';
    }
  }

  cmsPreviewViewportWidth(): number {
    switch (this.cmsPrefs.previewDevice()) {
      case 'mobile':
        return 390;
      case 'tablet':
        return 768;
      default:
        return 1024;
    }
  }

  private previewScrollSyncActive = false;

  syncSplitScroll(source: HTMLElement, target: HTMLElement): void {
    if (this.cmsPrefs.previewLayout() !== 'split') return;
    if (this.previewScrollSyncActive) return;

    const sourceScrollable = source.scrollHeight - source.clientHeight;
    const targetScrollable = target.scrollHeight - target.clientHeight;
    if (sourceScrollable <= 0 || targetScrollable <= 0) return;

    const ratio = sourceScrollable ? source.scrollTop / sourceScrollable : 0;
    this.previewScrollSyncActive = true;
    target.scrollTop = ratio * targetScrollable;

    requestAnimationFrame(() => {
      this.previewScrollSyncActive = false;
    });
  }

  ngOnInit(): void {
    const initialSection = this.normalizeSection(this.route.snapshot.data['section']);
    this.applySection(initialSection);
    this.applyContentEditQuery(initialSection, this.route.snapshot.queryParams || {});

    this.routeSub = combineLatest([this.route.data, this.route.queryParams]).subscribe(([data, query]) => {
      const next = this.normalizeSection(data['section']);
      this.applySection(next);
      this.applyContentEditQuery(next, query || {});
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.routeSub = undefined;
    this.stopCmsDraftPoller();
    this.cmsHomeDraft.dispose();
    for (const manager of this.cmsPageDrafts.values()) manager.dispose();
    for (const manager of this.cmsBlogDrafts.values()) manager.dispose();
    for (const key of Object.keys(this.contentVersions)) {
      delete this.contentVersions[key];
    }
  }

  hasUnsavedChanges(): boolean {
    if (this.cmsHomeDraft.isReady() && this.cmsHomeDraft.dirty) return true;

    for (const manager of this.cmsPageDrafts.values()) {
      if (manager.isReady() && manager.dirty) return true;
    }

    for (const manager of this.cmsBlogDrafts.values()) {
      if (manager.isReady() && manager.dirty) return true;
    }

    return false;
  }

  discardUnsavedChanges(): void {
    if (this.cmsHomeDraft.isReady()) this.cmsHomeDraft.discardAutosave();
    for (const manager of this.cmsPageDrafts.values()) manager.discardAutosave();
    for (const manager of this.cmsBlogDrafts.values()) manager.discardAutosave();
  }

  loadAll(): void {
    this.loadForSection(this.section());
  }

  retryLoadAll(): void {
    this.loadAll();
  }

  private normalizeSection(value: unknown): AdminContentSection {
    if (value === 'home' || value === 'pages' || value === 'blog' || value === 'settings') return value;
    return 'home';
  }

  private applySection(next: AdminContentSection): void {
    if (this.section() === next) {
      this.loadForSection(next);
      this.syncCmsDraftPoller(next);
      return;
    }
    this.section.set(next);
    this.crumbs = [
      { label: 'adminUi.nav.content', url: '/admin/content' },
      { label: `adminUi.content.nav.${next}` }
    ];
    this.resetSectionState(next);
    this.loadForSection(next);
    this.syncCmsDraftPoller(next);
  }

  private applyContentEditQuery(section: AdminContentSection, query: Params): void {
    const raw = typeof query['edit'] === 'string' ? query['edit'] : '';
    const cleaned = raw.trim();
    if (!cleaned) return;

    if (section === 'blog') {
      const key = cleaned.startsWith('blog.') ? cleaned : `blog.${cleaned}`;
      if (this.selectedBlogKey === key) return;
      this.loadBlogEditor(key);
      return;
    }

    if (section === 'pages') {
      const key = isCmsGlobalSectionKey(cleaned) ? cleaned : cleaned.startsWith('page.') ? cleaned : `page.${cleaned}`;
      const normalized = key.trim();
      if (!normalized || normalized === 'page.') return;
      if (normalized === this.pageBlocksKey) return;
      this.onPageBlocksKeyChange(normalized as PageBuilderKey);
    }
  }

  private syncCmsDraftPoller(section: AdminContentSection): void {
    const shouldPoll = section === 'home' || section === 'pages' || section === 'blog';
    if (!shouldPoll) {
      this.stopCmsDraftPoller();
      return;
    }
    if (typeof window === 'undefined' || this.cmsDraftPoller !== null) return;
    this.observeCmsDrafts();
    this.cmsDraftPoller = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      this.observeCmsDrafts();
    }, CMS_DRAFT_POLL_INTERVAL_MS);
  }

  private stopCmsDraftPoller(): void {
    if (this.cmsDraftPoller === null || typeof window === 'undefined') return;
    window.clearInterval(this.cmsDraftPoller);
    this.cmsDraftPoller = null;
  }

  private resetSectionState(next: AdminContentSection): void {
    this.error.set(null);
    this.errorRequestId.set(null);
    if (next !== 'blog') {
      this.closeBlogEditor();
      this.showBlogCreate = false;
      this.flaggedComments.set([]);
      this.flaggedCommentsError = null;
    }
    if (next !== 'settings') {
      this.selectedContent = null;
      this.showContentPreview = false;
    }
  }

  private loadForSection(section: AdminContentSection): void {
    this.loading.set(true);
    this.error.set(null);
    this.errorRequestId.set(null);

    if (section === 'home') {
      this.admin.products().subscribe({ next: (p) => (this.products = p), error: () => (this.products = []) });
      this.loadSections();
      this.loadCollections();
      this.loading.set(false);
      return;
    }

    if (section === 'pages') {
      this.loadInfo();
      this.loadLegalPage(this.legalPageKey);
      this.loadCategories();
      this.loadCollections();
      this.loadContentPages();
      this.loadReusableBlocks();
      this.loadPageBlocks(this.pageBlocksKey);
      this.loadContentRedirects(true);
      this.loading.set(false);
      return;
    }

    if (section === 'blog') {
      this.reloadContentBlocks();
      this.loadFlaggedComments();
      this.loading.set(false);
      return;
    }

    // settings
    this.reloadContentBlocks();
    this.admin.coupons().subscribe({ next: (c) => (this.coupons = c), error: () => (this.coupons = []) });
    this.admin.lowStock().subscribe({ next: (items) => (this.lowStock = items), error: () => (this.lowStock = []) });
    this.admin.audit().subscribe({
      next: (logs) => {
        this.productAudit = logs.products;
        this.contentAudit = logs.content;
        this.securityAudit = logs.security ?? [];
      },
      error: () => this.toast.error(this.t('adminUi.audit.errors.loadTitle'), this.t('adminUi.audit.errors.loadCopy'))
    });
    this.loadCategories();
    this.loadTaxGroups();
    this.loadAssets();
    this.loadSocial();
    this.loadCompany();
    this.loadNavigation();
    this.loadCheckoutSettings();
    this.loadReportsSettings();
    this.loadSeo();
    this.loadFxStatus();
    this.admin.getMaintenance().subscribe({
      next: (m) => {
        this.maintenanceEnabled.set(m.enabled);
        this.maintenanceEnabledValue = m.enabled;
      }
    });
    this.loading.set(false);
  }

  loadAudit(): void {
    this.admin.audit().subscribe({
      next: (logs) => {
        this.productAudit = logs.products;
        this.contentAudit = logs.content;
        this.securityAudit = logs.security ?? [];
      },
      error: () => {
        this.toast.error(this.t('adminUi.audit.errors.loadTitle'), this.t('adminUi.audit.errors.loadCopy'));
      }
    });
  }

  submitOwnerTransfer(): void {
    if (!this.isOwner()) return;
    this.ownerTransferError = null;
    const identifier = this.ownerTransferIdentifier.trim();
    const confirm = this.ownerTransferConfirm.trim();
    if (!identifier) {
      this.ownerTransferError = this.t('adminUi.ownerTransfer.errors.identifier');
      return;
    }
    const password = (window.prompt(this.t('adminUi.ownerTransfer.passwordLabel')) || '').trim();
    if (!password) {
      this.ownerTransferError = this.t('adminUi.ownerTransfer.passwordRequired');
      return;
    }
    this.ownerTransferLoading = true;
    this.admin.transferOwner({ identifier, confirm, password }).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.ownerTransfer.successTitle'), this.t('adminUi.ownerTransfer.successCopy'));
        this.ownerTransferConfirm = '';
        this.ownerTransferIdentifier = '';
        this.auth.loadCurrentUser().subscribe();
        this.loadAudit();
      },
      error: (err) => {
        const detail = err?.error?.detail;
        this.ownerTransferError = typeof detail === 'string' && detail ? detail : this.t('adminUi.ownerTransfer.errors.generic');
        this.ownerTransferLoading = false;
      },
      complete: () => {
        this.ownerTransferLoading = false;
      }
    });
  }

  loadFxStatus(): void {
    this.fxLoading.set(true);
    this.fxError.set(null);
    this.loadFxAudit();
    this.fxAdmin.getStatus().subscribe({
      next: (status) => {
        this.fxStatus.set(status);
        const current = status.override ?? status.effective;
        this.fxOverrideForm = {
          eur_per_ron: Number(current.eur_per_ron) || 0,
          usd_per_ron: Number(current.usd_per_ron) || 0,
          as_of: current.as_of || ''
        };
      },
      error: () => {
        this.fxError.set(this.t('adminUi.fx.errors.load'));
      },
      complete: () => {
        this.fxLoading.set(false);
      }
    });
  }

  loadFxAudit(): void {
    this.fxAuditLoading.set(true);
    this.fxAuditError.set(null);
    this.fxAdmin.listOverrideAudit(50).subscribe({
      next: (items) => {
        this.fxAudit.set(Array.isArray(items) ? items : []);
      },
      error: () => {
        this.fxAudit.set([]);
        this.fxAuditError.set(this.t('adminUi.fx.audit.errors.load'));
      },
      complete: () => {
        this.fxAuditLoading.set(false);
      }
    });
  }

  fxAuditActionLabel(action: string): string {
    const normalized = (action || '').trim().toLowerCase();
    const key = `adminUi.fx.audit.actions.${normalized}`;
    const translated = this.t(key);
    return translated === key ? action : translated;
  }

  restoreFxOverrideFromAudit(entry: FxOverrideAuditEntry): void {
    const id = (entry?.id || '').toString().trim();
    if (!id) return;
    if (!confirm(this.t('adminUi.fx.audit.confirmRestore'))) return;
    this.fxAuditRestoring.set(id);
    this.fxAdmin.restoreOverrideFromAudit(id).subscribe({
      next: (status) => {
        this.fxStatus.set(status);
        const current = status.override ?? status.effective;
        this.fxOverrideForm = {
          eur_per_ron: Number(current.eur_per_ron) || 0,
          usd_per_ron: Number(current.usd_per_ron) || 0,
          as_of: current.as_of || ''
        };
        this.toast.success(this.t('adminUi.fx.success.overrideRestored'));
        this.loadFxAudit();
      },
      error: () => {
        this.toast.error(this.t('adminUi.fx.audit.errors.restore'));
      },
      complete: () => {
        this.fxAuditRestoring.set(null);
      }
    });
  }

  resetFxOverrideForm(): void {
    const status = this.fxStatus();
    if (!status) return;
    const current = status.override ?? status.effective;
    this.fxOverrideForm = {
      eur_per_ron: Number(current.eur_per_ron) || 0,
      usd_per_ron: Number(current.usd_per_ron) || 0,
      as_of: current.as_of || ''
    };
  }

  saveFxOverride(): void {
    const eur = Number(this.fxOverrideForm.eur_per_ron);
    const usd = Number(this.fxOverrideForm.usd_per_ron);
    const asOf = (this.fxOverrideForm.as_of || '').trim();
    if (!(eur > 0) || !(usd > 0)) {
      this.toast.error(this.t('adminUi.fx.errors.invalid'));
      return;
    }

    this.fxAdmin
      .setOverride({
        eur_per_ron: eur,
        usd_per_ron: usd,
        as_of: asOf ? asOf : null
      })
      .subscribe({
        next: () => {
          this.toast.success(this.t('adminUi.fx.success.overrideSet'));
          this.loadFxStatus();
        },
        error: () => this.toast.error(this.t('adminUi.fx.errors.overrideSet'))
      });
  }

  clearFxOverride(): void {
    const status = this.fxStatus();
    if (!status?.override) return;
    if (!confirm(this.t('adminUi.fx.confirmClear'))) return;
    this.fxAdmin.clearOverride().subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.fx.success.overrideCleared'));
        this.loadFxStatus();
      },
      error: () => this.toast.error(this.t('adminUi.fx.errors.overrideCleared'))
    });
  }

  startNewProduct(): void {
    this.editingId = null;
    this.productDetail = null;
    this.productImages.set([]);
    this.form = {
      name: '',
      slug: '',
      category_id: this.categories[0]?.id || '',
      price: 0,
      stock: 0,
      status: 'draft',
      sku: '',
      image: '',
      description: '',
      publish_at: '',
      is_bestseller: false
    };
  }

  loadProduct(slug: string): void {
    this.admin.getProduct(slug).subscribe({
      next: (prod) => {
        this.productDetail = prod;
        this.editingId = prod.slug;
        this.form = {
          name: prod.name,
          slug: prod.slug,
          category_id: prod.category_id || '',
          price: prod.price,
          stock: prod.stock_quantity,
          status: prod.status,
          sku: (prod).sku || '',
          image: '',
          description: prod.long_description || '',
          publish_at: prod.publish_at ? this.toLocalDateTime(prod.publish_at) : '',
          is_bestseller: (prod.tags || []).includes('bestseller')
        };
        this.productImages.set((prod).images || []);
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.load'))
    });
  }

  saveProduct(): void {
    const payload: Partial<AdminProductDetail> = {
      name: this.form.name,
      slug: this.form.slug,
      category_id: this.form.category_id,
      base_price: this.form.price,
      stock_quantity: this.form.stock,
      status: this.form.status as any,
      short_description: this.form.description,
      long_description: this.form.description,
      sku: this.form.sku,
      publish_at: this.form.publish_at ? new Date(this.form.publish_at).toISOString() : null,
      tags: this.buildTags()
    } as any;
    const op = this.editingId
      ? this.admin.updateProduct(this.editingId, payload)
      : this.admin.createProduct(payload);
    op.subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.products.success.save'));
        this.loadAll();
        this.startNewProduct();
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.save'))
    });
  }

  deleteSelected(): void {
    if (!this.selectedIds.size) return;
    const ids = Array.from(this.selectedIds);
    const target = this.products.find((p) => p.id === ids[0]);
    if (!target) return;
    this.admin.deleteProduct(target.slug).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.products.success.delete'));
        this.products = this.products.filter((p) => !this.selectedIds.has(p.id));
        this.selectedIds.clear();
        this.computeAllSelected();
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.delete'))
    });
  }

  startCategoryWizard(): void {
    this.categoryWizardOpen.set(true);
    this.categoryWizardStep.set(0);
    this.categoryWizardSlug.set(null);
  }

  exitCategoryWizard(): void {
    this.categoryWizardOpen.set(false);
    this.categoryWizardStep.set(0);
    this.categoryWizardSlug.set(null);
  }

  categoryWizardDescriptionKey(): string {
    return this.categoryWizardSteps[this.categoryWizardStep()]?.descriptionKey ?? 'adminUi.categories.wizard.desc.basics';
  }

  categoryWizardNextLabelKey(): string {
    return this.categoryWizardStep() >= this.categoryWizardSteps.length - 1 ? 'adminUi.actions.done' : 'adminUi.actions.next';
  }

  categoryWizardCanNext(): boolean {
    if (!this.categoryWizardOpen()) return false;
    if (this.categoryWizardStep() >= this.categoryWizardSteps.length - 1) return true;
    return Boolean(this.categoryWizardSlug());
  }

  categoryWizardPrev(): void {
    const next = this.categoryWizardStep() - 1;
    if (next < 0) return;
    this.categoryWizardStep.set(next);
  }

  categoryWizardNext(): void {
    if (!this.categoryWizardOpen()) return;
    if (this.categoryWizardStep() >= this.categoryWizardSteps.length - 1) {
      this.exitCategoryWizard();
      return;
    }
    if (!this.categoryWizardCanNext()) {
      this.toast.error(this.t('adminUi.categories.wizard.addFirst'));
      return;
    }
    this.categoryWizardStep.set(this.categoryWizardStep() + 1);
    if (this.categoryWizardStep() === 1) {
      this.openCategoryWizardTranslations();
    }
  }

  goToCategoryWizardStep(index: number): void {
    if (!this.categoryWizardOpen()) return;
    if (index < 0 || index >= this.categoryWizardSteps.length) return;
    if (index > 0 && !this.categoryWizardSlug()) {
      this.toast.error(this.t('adminUi.categories.wizard.addFirst'));
      this.categoryWizardStep.set(0);
      return;
    }
    this.categoryWizardStep.set(index);
    if (index === 1) {
      this.openCategoryWizardTranslations();
    }
  }

  openCategoryWizardTranslations(): void {
    const slug = this.categoryWizardSlug();
    if (!slug) return;
    if (this.categoryTranslationsSlug !== slug) {
      this.categoryTranslationsSlug = slug;
      this.loadCategoryTranslations(slug);
    }
  }

  addCategory(): void {
    if (!this.categoryName) {
      this.toast.error(this.t('adminUi.categories.errors.required'));
      return;
    }
    const parent_id = (this.categoryParentId || '').trim() || null;
    this.admin.createCategory({ name: this.categoryName, parent_id }).subscribe({
      next: (cat) => {
        this.categories = [cat, ...this.categories];
        this.categoryName = '';
        this.categoryParentId = '';
        this.toast.success(this.t('adminUi.categories.success.add'));
        if (this.categoryWizardOpen() && this.categoryWizardStep() === 0) {
          const slug = typeof cat?.slug === 'string' ? cat.slug : '';
          if (slug) {
            this.categoryWizardSlug.set(slug);
            this.categoryWizardStep.set(1);
            this.openCategoryWizardTranslations();
          }
        }
      },
      error: () => this.toast.error(this.t('adminUi.categories.errors.add'))
    });
  }

  loadTaxGroups(): void {
    this.taxGroupsLoading = true;
    this.taxGroupsError = null;
    this.taxesAdmin.listGroups().subscribe({
      next: (groups) => {
        this.taxGroups = Array.isArray(groups) ? groups : [];
        this.taxGroupsLoading = false;
      },
      error: (err) => {
        this.taxGroupsLoading = false;
        this.taxGroups = [];
        this.taxGroupsError = err?.error?.detail || this.t('adminUi.taxes.errors.load');
      }
    });
  }

  createTaxGroup(): void {
    const code = (this.taxGroupCreate.code || '').trim();
    const name = (this.taxGroupCreate.name || '').trim();
    if (!code || !name) {
      this.toast.error(this.t('adminUi.taxes.errors.required'));
      return;
    }
    this.taxesAdmin
      .createGroup({
        code,
        name,
        description: (this.taxGroupCreate.description || '').trim() || null,
        is_default: !!this.taxGroupCreate.is_default
      })
      .subscribe({
        next: () => {
          this.taxGroupCreate = { code: '', name: '', description: '', is_default: false };
          this.toast.success(this.t('adminUi.taxes.success.create'));
          this.loadTaxGroups();
        },
        error: (err) => this.toast.error(err?.error?.detail || this.t('adminUi.taxes.errors.create'))
      });
  }

  saveTaxGroup(group: TaxGroupRead): void {
    const name = (group.name || '').trim();
    if (!name) {
      this.toast.error(this.t('adminUi.taxes.errors.required'));
      return;
    }
    this.taxesAdmin
      .updateGroup(group.id, { name, description: (group.description || '').trim() || null })
      .subscribe({
        next: () => {
          this.toast.success(this.t('adminUi.taxes.success.update'));
          this.loadTaxGroups();
        },
        error: (err) => this.toast.error(err?.error?.detail || this.t('adminUi.taxes.errors.update'))
      });
  }

  setDefaultTaxGroup(group: TaxGroupRead): void {
    if (group.is_default) return;
    this.taxesAdmin.updateGroup(group.id, { is_default: true }).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.taxes.success.default'));
        this.loadTaxGroups();
      },
      error: (err) => this.toast.error(err?.error?.detail || this.t('adminUi.taxes.errors.update'))
    });
  }

  deleteTaxGroup(group: TaxGroupRead): void {
    if (group.is_default) {
      this.toast.error(this.t('adminUi.taxes.errors.deleteDefault'));
      return;
    }
    this.taxesAdmin.deleteGroup(group.id).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.taxes.success.delete'));
        this.loadTaxGroups();
      },
      error: (err) => this.toast.error(err?.error?.detail || this.t('adminUi.taxes.errors.delete'))
    });
  }

  upsertTaxRate(group: TaxGroupRead): void {
    const rawCountry = (this.taxRateCountry[group.id] || '').trim();
    const rawRate = String(this.taxRatePercent[group.id] || '').trim();
    const vat = Number(rawRate);
    if (!rawCountry || !Number.isFinite(vat)) {
      this.toast.error(this.t('adminUi.taxes.errors.rateInvalid'));
      return;
    }
    this.taxesAdmin.upsertRate(group.id, { country_code: rawCountry, vat_rate_percent: vat }).subscribe({
      next: () => {
        this.taxRateCountry[group.id] = '';
        this.taxRatePercent[group.id] = '';
        this.toast.success(this.t('adminUi.taxes.success.rate'));
        this.loadTaxGroups();
      },
      error: (err) => this.toast.error(err?.error?.detail || this.t('adminUi.taxes.errors.rate'))
    });
  }

  deleteTaxRate(group: TaxGroupRead, countryCode: string): void {
    const code = (countryCode || '').trim();
    if (!code) return;
    this.taxesAdmin.deleteRate(group.id, code).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.taxes.success.rateDelete'));
        this.loadTaxGroups();
      },
      error: (err) => this.toast.error(err?.error?.detail || this.t('adminUi.taxes.errors.rateDelete'))
    });
  }

  categoryParentLabel(cat: AdminCategory): string {
    const parentId = (cat.parent_id ?? '').trim();
    if (!parentId) return this.t('adminUi.categories.parentNone');
    return this.categories.find((c) => c.id === parentId)?.name ?? this.t('adminUi.categories.parentNone');
  }

  categoryParentOptions(cat: AdminCategory): AdminCategory[] {
    const currentId = cat.id;
    const excluded = this.categoryDescendantIds(currentId);
    excluded.add(currentId);
    return this.categories
      .filter((candidate) => !excluded.has(candidate.id))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }

  private categoryDescendantIds(rootId: string): Set<string> {
    const childrenByParent = new Map<string, string[]>();
    for (const cat of this.categories) {
      const parentId = (cat.parent_id ?? '').trim();
      if (!parentId) continue;
      const bucket = childrenByParent.get(parentId);
      if (bucket) {
        bucket.push(cat.id);
      } else {
        childrenByParent.set(parentId, [cat.id]);
      }
    }
    const resolved = new Set<string>();
    const stack = [...(childrenByParent.get(rootId) ?? [])];
    while (stack.length) {
      const next = stack.pop()!;
      if (resolved.has(next)) continue;
      resolved.add(next);
      const kids = childrenByParent.get(next);
      if (kids?.length) stack.push(...kids);
    }
    return resolved;
  }

  updateCategoryParent(cat: AdminCategory, raw: string): void {
    const nextParentId = (raw ?? '').trim() || null;
    const prevParentId = (cat.parent_id ?? '').trim() || null;
    if (nextParentId === prevParentId) return;
    cat.parent_id = nextParentId;
    this.admin.updateCategory(cat.slug, { parent_id: nextParentId }).subscribe({
      next: (updated) => {
        cat.parent_id = updated.parent_id ?? null;
        this.toast.success(this.t('adminUi.categories.success.updateParent'));
      },
      error: () => {
        cat.parent_id = prevParentId;
        this.toast.error(this.t('adminUi.categories.errors.updateParent'));
      }
    });
  }

  updateCategoryLowStockThreshold(cat: AdminCategory, raw: string | number): void {
    const prevThreshold = cat.low_stock_threshold ?? null;
    const trimmed = String(raw ?? '').trim();
    const nextThreshold = trimmed ? Number(trimmed) : null;
    if (nextThreshold !== null && (!Number.isFinite(nextThreshold) || nextThreshold < 0)) {
      cat.low_stock_threshold = prevThreshold;
      this.toast.error(this.t('adminUi.categories.errors.updateLowStockThreshold'));
      return;
    }
    if (nextThreshold === prevThreshold) return;
    cat.low_stock_threshold = nextThreshold;
    this.admin.updateCategory(cat.slug, { low_stock_threshold: nextThreshold }).subscribe({
      next: (updated) => {
        cat.low_stock_threshold = updated.low_stock_threshold ?? null;
        this.toast.success(this.t('adminUi.categories.success.updateLowStockThreshold'));
      },
      error: () => {
        cat.low_stock_threshold = prevThreshold;
        this.toast.error(this.t('adminUi.categories.errors.updateLowStockThreshold'));
      }
    });
  }

  updateCategoryTaxGroup(cat: AdminCategory, raw: string): void {
    const nextGroupId = (raw ?? '').trim() || null;
    const prevGroupId = (cat.tax_group_id ?? '').trim() || null;
    if (nextGroupId === prevGroupId) return;
    cat.tax_group_id = nextGroupId;
    this.admin.updateCategory(cat.slug, { tax_group_id: nextGroupId }).subscribe({
      next: (updated) => {
        cat.tax_group_id = updated.tax_group_id ?? null;
        this.toast.success(this.t('adminUi.taxes.success.categoryAssign'));
      },
      error: () => {
        cat.tax_group_id = prevGroupId;
        this.toast.error(this.t('adminUi.taxes.errors.categoryAssign'));
      }
    });
  }

  openCategoryDeleteConfirm(cat: AdminCategory): void {
    this.categoryDeleteConfirmTarget.set(cat);
    this.categoryDeleteConfirmBusy.set(false);
    this.categoryDeleteConfirmOpen.set(true);
  }

  closeCategoryDeleteConfirm(): void {
    this.categoryDeleteConfirmOpen.set(false);
    this.categoryDeleteConfirmBusy.set(false);
    this.categoryDeleteConfirmTarget.set(null);
  }

  confirmDeleteCategory(): void {
    const target = this.categoryDeleteConfirmTarget();
    if (!target) return;
    if (this.categoryDeleteConfirmBusy()) return;
    this.categoryDeleteConfirmBusy.set(true);
    this.deleteCategory(target.slug, {
      done: (ok) => {
        this.categoryDeleteConfirmBusy.set(false);
        if (ok) this.closeCategoryDeleteConfirm();
      }
    });
  }

  deleteCategory(slug: string, opts?: { done?: (ok: boolean) => void }): void {
    this.admin.deleteCategory(slug).subscribe({
      next: () => {
        this.categories = this.categories.filter((c) => c.slug !== slug);
        if (this.categoryTranslationsSlug === slug) this.closeCategoryTranslations();
        this.toast.success(this.t('adminUi.categories.success.delete'));
        opts?.done?.(true);
      },
      error: () => {
        this.toast.error(this.t('adminUi.categories.errors.delete'));
        opts?.done?.(false);
      }
    });
  }

  toggleCategoryTranslations(slug: string): void {
    if (this.categoryTranslationsSlug === slug) {
      this.closeCategoryTranslations();
      return;
    }
    this.categoryTranslationsSlug = slug;
    this.loadCategoryTranslations(slug);
  }

  closeCategoryTranslations(): void {
    this.categoryTranslationsSlug = null;
    this.categoryTranslationsError.set(null);
    this.categoryTranslationExists = { en: false, ro: false };
    this.categoryTranslations = { en: this.blankCategoryTranslation(), ro: this.blankCategoryTranslation() };
  }

  saveCategoryTranslation(lang: 'en' | 'ro'): void {
    const slug = this.categoryTranslationsSlug;
    if (!slug) return;
    this.categoryTranslationsError.set(null);

    const name = this.categoryTranslations[lang].name.trim();
    if (!name) {
      this.toast.error(this.t('adminUi.categories.translations.errors.nameRequired'));
      return;
    }

    const payload = {
      name,
      description: this.categoryTranslations[lang].description.trim() ? this.categoryTranslations[lang].description.trim() : null
    };
    this.admin.upsertCategoryTranslation(slug, lang, payload).subscribe({
      next: (updated) => {
        this.categoryTranslationExists[lang] = true;
        this.categoryTranslations[lang] = {
          name: (updated.name || name).toString(),
          description: (updated.description || '').toString()
        };
        this.toast.success(this.t('adminUi.categories.translations.success.save'));
      },
      error: () => this.categoryTranslationsError.set(this.t('adminUi.categories.translations.errors.save'))
    });
  }

  deleteCategoryTranslation(lang: 'en' | 'ro'): void {
    const slug = this.categoryTranslationsSlug;
    if (!slug) return;
    this.categoryTranslationsError.set(null);
    this.admin.deleteCategoryTranslation(slug, lang).subscribe({
      next: () => {
        this.categoryTranslationExists[lang] = false;
        this.categoryTranslations[lang] = this.blankCategoryTranslation();
        this.toast.success(this.t('adminUi.categories.translations.success.delete'));
      },
      error: () => this.categoryTranslationsError.set(this.t('adminUi.categories.translations.errors.delete'))
    });
  }

  private blankCategoryTranslation(): { name: string; description: string } {
    return { name: '', description: '' };
  }

  private loadCategoryTranslations(slug: string): void {
    this.categoryTranslationsError.set(null);
    this.admin.getCategoryTranslations(slug).subscribe({
      next: (items) => {
        const mapped: Record<'en' | 'ro', { name: string; description: string }> = {
          en: this.blankCategoryTranslation(),
          ro: this.blankCategoryTranslation()
        };
        const exists: Record<'en' | 'ro', boolean> = { en: false, ro: false };
        for (const t of items || []) {
          if (t.lang !== 'en' && t.lang !== 'ro') continue;
          exists[t.lang] = true;
          mapped[t.lang] = {
            name: (t.name || '').toString(),
            description: (t.description || '').toString()
          };
        }
        this.categoryTranslationExists = exists;
        this.categoryTranslations = mapped;
      },
      error: () => this.categoryTranslationsError.set(this.t('adminUi.categories.translations.errors.load'))
    });
  }

  duplicateProduct(slug: string): void {
    this.admin.duplicateProduct(slug).subscribe({
      next: (prod) => {
        this.toast.success(this.t('adminUi.products.success.duplicate'));
        this.loadAll();
        this.loadProduct(prod.slug);
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.duplicate'))
    });
  }

  setStock(id: string, value: number): void {
    this.stockEdits[id] = Number(value);
  }

  saveStock(product: AdminProduct): void {
    const newStock = this.stockEdits[product.id] ?? product.stock_quantity;
    this.admin.updateProduct(product.slug, { stock_quantity: newStock } as any).subscribe({
      next: () => {
        product.stock_quantity = newStock;
        this.toast.success(this.t('adminUi.products.success.save'));
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.save'))
    });
  }

  async saveBulkStock(): Promise<void> {
    if (this.bulkStock === null || !this.selectedIds.size) return;
    const tasks = Array.from(this.selectedIds).map((id) => {
      const prod = this.products.find((p) => p.id === id);
      if (!prod) return Promise.resolve();
      return firstValueFrom(this.admin.updateProduct(prod.slug, { stock_quantity: this.bulkStock! } as any)).then(() => {
        prod.stock_quantity = this.bulkStock!;
      });
    });
    try {
      await Promise.all(tasks);
      this.toast.success(this.t('adminUi.products.success.save'));
    } catch {
      this.toast.error(this.t('adminUi.products.errors.save'));
    }
  }

  buildTags(): string[] {
    const tags = new Set<string>();
    if (this.form.is_bestseller) tags.add('bestseller');
    if (this.productDetail?.tags) this.productDetail.tags.forEach((t) => tags.add(t));
    return Array.from(tags);
  }

  upcomingProducts(): AdminProduct[] {
    const now = new Date();
    return this.products
      .filter((p) => p.publish_at && new Date(p.publish_at) > now)
      .sort((a, b) => new Date(a.publish_at || 0).getTime() - new Date(b.publish_at || 0).getTime());
  }

  toLocalDateTime(iso: string): string {
    const d = new Date(iso);
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  }

  onImageUpload(event: Event): void {
    if (!this.editingId) {
      this.toast.error(this.t('adminUi.products.errors.saveFirst'));
      return;
    }
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.admin.uploadProductImage(this.editingId, file).subscribe({
      next: (prod) => {
        this.productImages.set((prod).images || []);
        this.toast.success(this.t('adminUi.products.success.imageUpload'));
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.image'))
    });
  }

  deleteImage(id: string): void {
    if (!this.editingId) return;
    this.admin.deleteProductImage(this.editingId, id).subscribe({
      next: (prod) => {
        this.productImages.set((prod).images || []);
        this.toast.success(this.t('adminUi.products.success.imageDelete'));
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.deleteImage'))
    });
  }

  selectOrder(order: AdminOrder): void {
    this.activeOrder = { ...order };
  }

  filteredOrders(): AdminOrder[] {
    return this.orders.filter((o) => (this.orderFilter ? o.status === this.orderFilter : true));
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.allSelected = checked;
    if (checked) this.selectedIds = new Set(this.products.map((p) => p.id));
    else this.selectedIds.clear();
  }

  toggleSelect(id: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) this.selectedIds.add(id);
    else this.selectedIds.delete(id);
    this.computeAllSelected();
  }

  computeAllSelected(): void {
    this.allSelected = this.selectedIds.size > 0 && this.selectedIds.size === this.products.length;
  }

  changeOrderStatus(status: string): void {
    if (!this.activeOrder) return;
    this.admin.updateOrderStatus(this.activeOrder.id, status).subscribe({
      next: (order) => {
        this.toast.success(this.t('adminUi.orders.success.status'));
        this.activeOrder = order;
        this.orders = this.orders.map((o) => (o.id === order.id ? order : o));
      },
      error: () => this.toast.error(this.t('adminUi.orders.errors.status'))
    });
  }

  forceLogout(): void {
    if (!this.selectedUserId) return;
    this.admin.revokeSessions(this.selectedUserId).subscribe({
      next: () => this.toast.success(this.t('adminUi.users.success.revoke')),
      error: () => this.toast.error(this.t('adminUi.users.errors.revoke'))
    });
  }

  selectUser(userId: string, role: string): void {
    this.selectedUserId = userId;
    this.selectedUserRole = role;
    this.loadUserAliases(userId);
  }

  onSelectedUserIdChange(userId: string): void {
    this.selectedUserId = userId;
    const user = this.users.find((u) => u.id === userId);
    this.selectedUserRole = user?.role ?? this.selectedUserRole;
    this.loadUserAliases(userId);
  }

  loadUserAliases(userId: string): void {
    if (!userId) return;
    this.userAliasesLoading = true;
    this.userAliasesError = null;
    this.userAliases = null;
    this.admin.userAliases(userId).subscribe({
      next: (resp) => {
        this.userAliases = resp;
      },
      error: () => {
        this.userAliasesError = 'Could not load alias history.';
      },
      complete: () => {
        this.userAliasesLoading = false;
      }
    });
  }

  userIdentity(user: AdminUser): string {
    return formatIdentity(user, user.email);
  }

  commentAuthorLabel(author: { id: string; name?: string | null; username?: string | null; name_tag?: number | null }): string {
    return formatIdentity(author, author.id);
  }

  updateRole(): void {
    if (!this.selectedUserId || !this.selectedUserRole) return;
    const password = (window.prompt(this.t('adminUi.users.rolePasswordPrompt')) || '').trim();
    if (!password) {
      this.toast.error(this.t('adminUi.users.rolePasswordRequired'));
      return;
    }
    this.admin.updateUserRole(this.selectedUserId, this.selectedUserRole, password).subscribe({
      next: (updated) => {
        this.users = this.users.map((u) => (u.id === updated.id ? updated : u));
        this.toast.success(this.t('adminUi.users.success.role'));
      },
      error: () => this.toast.error(this.t('adminUi.users.errors.role'))
    });
  }

  moveCategory(cat: AdminCategory, delta: number): void {
    const sorted = [...this.categories].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const index = sorted.findIndex((c) => c.slug === cat.slug);
    const swapIndex = index + delta;
    if (index < 0 || swapIndex < 0 || swapIndex >= sorted.length) return;
    const tmp = sorted[index].sort_order ?? 0;
    sorted[index].sort_order = sorted[swapIndex].sort_order ?? 0;
    sorted[swapIndex].sort_order = tmp;
    this.admin
      .reorderCategories(sorted.map((c) => ({ slug: c.slug, sort_order: c.sort_order ?? 0 })))
      .subscribe({
        next: (cats) => {
          this.categories = cats
            .map((c) => ({ ...c, sort_order: c.sort_order ?? 0 }))
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          this.toast.success(this.t('adminUi.categories.success.reorder'));
        },
        error: () => this.toast.error(this.t('adminUi.categories.errors.reorder'))
      });
  }

  onCategoryDragStart(slug: string): void {
    this.draggingSlug = slug;
  }

  onCategoryDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onCategoryDrop(targetSlug: string): void {
    if (!this.draggingSlug || this.draggingSlug === targetSlug) {
      this.draggingSlug = null;
      return;
    }
    const sorted = [...this.categories].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const fromIdx = sorted.findIndex((c) => c.slug === this.draggingSlug);
    const toIdx = sorted.findIndex((c) => c.slug === targetSlug);
    if (fromIdx === -1 || toIdx === -1) {
      this.draggingSlug = null;
      return;
    }
    const [moved] = sorted.splice(fromIdx, 1);
    sorted.splice(toIdx, 0, moved);
    sorted.forEach((c, idx) => (c.sort_order = idx));
    this.admin
      .reorderCategories(sorted.map((c) => ({ slug: c.slug, sort_order: c.sort_order ?? 0 })))
      .subscribe({
        next: (cats) => {
          this.categories = cats
            .map((c) => ({ ...c, sort_order: c.sort_order ?? 0 }))
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          this.toast.success(this.t('adminUi.categories.success.reorder'));
        },
        error: () => this.toast.error(this.t('adminUi.categories.errors.reorder')),
        complete: () => (this.draggingSlug = null)
      });
  }

  createCoupon(): void {
    if (!this.newCoupon.code) {
      this.toast.error(this.t('adminUi.coupons.errors.required'));
      return;
    }
    this.admin.createCoupon(this.newCoupon).subscribe({
      next: (c) => {
        this.coupons = [c, ...this.coupons];
        this.toast.success(this.t('adminUi.coupons.success.create'));
      },
      error: () => this.toast.error(this.t('adminUi.coupons.errors.create'))
    });
  }

  toggleCoupon(coupon: AdminCoupon): void {
    this.admin.updateCoupon(coupon.id, { active: !coupon.active }).subscribe({
      next: (c) => {
        this.coupons = this.coupons.map((x) => (x.id === c.id ? c : x));
        this.toast.success(this.t('adminUi.coupons.success.update'));
      },
      error: () => this.toast.error(this.t('adminUi.coupons.errors.update'))
    });
  }

  invalidateCouponStripe(coupon: AdminCoupon): void {
    this.admin.invalidateCouponStripeMappings(coupon.id).subscribe({
      next: (res) => {
        this.toast.success(this.t('adminUi.coupons.success.invalidateStripe', { count: res.deleted_mappings }));
      },
      error: () => this.toast.error(this.t('adminUi.coupons.errors.invalidateStripe'))
    });
  }

  selectContent(content: AdminContent): void {
    this.selectedContent = content;
    this.contentForm = { title: content.title, body_markdown: '', status: 'draft' };
    this.admin.getContent(content.key).subscribe({
      next: (block) => {
        this.rememberContentVersion(content.key, block);
        this.contentForm = {
          title: block.title,
          body_markdown: block.body_markdown,
          status: block.status
        };
      },
      error: () => this.toast.error(this.t('adminUi.content.errors.update'))
    });
  }

  saveContent(): void {
    if (!this.selectedContent) return;
    const key = this.selectedContent.key;
    const payload = this.withExpectedVersion(key, {
      title: this.contentForm.title,
      body_markdown: this.contentForm.body_markdown,
      status: this.contentForm.status as any
    });
    this.admin.updateContentBlock(key, payload).subscribe({
      next: (block) => {
        this.rememberContentVersion(key, block);
        this.toast.success(this.t('adminUi.content.success.update'));
        this.reloadContentBlocks();
        this.selectedContent = null;
      },
      error: (err) => {
        if (this.handleContentConflict(err, key, () => this.selectContent(this.selectedContent!))) return;
        this.toast.error(this.t('adminUi.content.errors.update'));
      }
    });
  }

  cancelContent(): void {
    this.selectedContent = null;
  }

  blogPosts(): AdminContent[] {
    return this.contentBlocks.filter((c) => c.key.startsWith('blog.'));
  }

  private pinnedSlotFromMeta(meta: Record<string, any> | null | undefined): number | null {
    if (!meta) return null;
    const pinned = meta['pinned'];
    let pinnedFlag = false;
    if (typeof pinned === 'boolean') pinnedFlag = pinned;
    else if (typeof pinned === 'number') pinnedFlag = pinned === 1;
    else if (typeof pinned === 'string') pinnedFlag = ['1', 'true', 'yes', 'on'].includes(pinned.trim().toLowerCase());
    if (!pinnedFlag) return null;
    const raw = meta['pin_order'];
    const parsed = Number(typeof raw === 'number' ? raw : typeof raw === 'string' ? raw.trim() : 1);
    const normalized = Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1;
    return Math.max(1, normalized);
  }

  blogPinnedSlot(post: AdminContent): number | null {
    return this.pinnedSlotFromMeta(post.meta || null);
  }

  blogPinnedPosts(): AdminContent[] {
    const pinned = this.blogPosts().filter((p) => Boolean(this.blogPinnedSlot(p)));
    return pinned.sort((a, b) => this.comparePinnedPosts(a, b));
  }

  private comparePinnedPosts(a: AdminContent, b: AdminContent): number {
    const ao = this.blogPinnedSlot(a) ?? 999;
    const bo = this.blogPinnedSlot(b) ?? 999;
    if (ao !== bo) return ao - bo;
    const ap = a.published_at ? Date.parse(a.published_at) : 0;
    const bp = b.published_at ? Date.parse(b.published_at) : 0;
    if (ap !== bp) return bp - ap;
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  }

  private nextBlogPinOrder(): number {
    const orders = this.blogPosts()
      .map((p) => this.blogPinnedSlot(p))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const max = orders.length ? Math.max(...orders) : 0;
    return max + 1;
  }

  onBlogPinDragStart(key: string): void {
    this.draggingBlogPinKey = (key || '').trim() || null;
  }

  onBlogPinDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  async onBlogPinDrop(targetKey: string): Promise<void> {
    const fromKey = (this.draggingBlogPinKey || '').trim();
    const toKey = (targetKey || '').trim();
    this.draggingBlogPinKey = null;
    if (!fromKey || !toKey || fromKey === toKey || this.blogPinsSaving) return;

    const pinned = this.blogPinnedPosts();
    const pinnedKeys = pinned.map((p) => p.key);
    const fromIdx = pinnedKeys.indexOf(fromKey);
    const toIdx = pinnedKeys.indexOf(toKey);
    if (fromIdx === -1 || toIdx === -1) return;

    const nextKeys = [...pinnedKeys];
    nextKeys.splice(fromIdx, 1);
    const insertIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
    nextKeys.splice(insertIdx, 0, fromKey);

    const updates: Array<{ key: string; meta: Record<string, any> }> = [];
    nextKeys.forEach((key, idx) => {
      const post = pinned.find((p) => p.key === key);
      if (!post) return;
      const nextOrder = idx + 1;
      if ((this.blogPinnedSlot(post) ?? 1) === nextOrder) return;
      const meta = { ...(post.meta || {}) };
      meta['pinned'] = true;
      meta['pin_order'] = nextOrder;
      updates.push({ key, meta });
    });
    if (!updates.length) return;

    this.blogPinsSaving = true;
    try {
      for (const update of updates) {
        const updated = await firstValueFrom(
          this.admin.updateContentBlock(update.key, this.withExpectedVersion(update.key, { meta: update.meta }))
        );
        this.rememberContentVersion(update.key, updated);
      }
      this.toast.success(this.t('adminUi.blog.pins.success.reordered'));
      this.reloadContentBlocks();
    } catch {
      this.toast.error(this.t('adminUi.blog.pins.errors.reorder'));
      this.reloadContentBlocks();
    } finally {
      this.blogPinsSaving = false;
    }
  }

  isBlogSelected(key: string): boolean {
    return this.blogBulkSelection.has(key);
  }

  toggleBlogSelection(key: string, event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (target?.checked) {
      this.blogBulkSelection.add(key);
    } else {
      this.blogBulkSelection.delete(key);
    }
    this.blogBulkError = '';
  }

  areAllBlogSelected(): boolean {
    const posts = this.blogPosts();
    if (!posts.length) return false;
    return posts.every((post) => this.blogBulkSelection.has(post.key));
  }

  toggleSelectAllBlogs(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    if (target.checked) {
      this.blogPosts().forEach((post) => this.blogBulkSelection.add(post.key));
    } else {
      this.blogBulkSelection.clear();
    }
    this.blogBulkError = '';
  }

  clearBlogBulkSelection(): void {
    this.blogBulkSelection.clear();
    this.blogBulkError = '';
  }

  canApplyBlogBulk(): boolean {
    if (this.blogBulkSelection.size === 0) return false;
    if (this.blogBulkAction === 'schedule') {
      const publishIso = this.toIsoFromLocal(this.blogBulkPublishAt);
      if (!publishIso) return false;
      if (this.blogBulkUnpublishAt) {
        const unpublishIso = this.toIsoFromLocal(this.blogBulkUnpublishAt);
        if (!unpublishIso) return false;
        if (new Date(unpublishIso).getTime() <= new Date(publishIso).getTime()) return false;
      }
    }
    if (this.blogBulkAction === 'tags_add' || this.blogBulkAction === 'tags_remove') {
      return this.parseTags(this.blogBulkTags).length > 0;
    }
    return true;
  }

  blogBulkPreview(): string {
    const count = this.blogBulkSelection.size;
    if (!count) return this.t('adminUi.blog.bulk.previewEmpty');
    switch (this.blogBulkAction) {
      case 'publish':
        return this.t('adminUi.blog.bulk.previewPublish', { count });
      case 'unpublish':
        return this.t('adminUi.blog.bulk.previewUnpublish', { count });
      case 'schedule': {
        const publishIso = this.toIsoFromLocal(this.blogBulkPublishAt);
        const publishLabel = publishIso ? new Date(publishIso).toLocaleString() : '—';
        const unpublishIso = this.toIsoFromLocal(this.blogBulkUnpublishAt);
        const unpublishLabel = unpublishIso ? new Date(unpublishIso).toLocaleString() : '—';
        return this.t('adminUi.blog.bulk.previewSchedule', { count, publish: publishLabel, unpublish: unpublishLabel });
      }
      case 'tags_add':
        return this.t('adminUi.blog.bulk.previewTagsAdd', { count, tags: this.parseTags(this.blogBulkTags).join(', ') });
      case 'tags_remove':
        return this.t('adminUi.blog.bulk.previewTagsRemove', { count, tags: this.parseTags(this.blogBulkTags).join(', ') });
      default:
        return this.t('adminUi.blog.bulk.previewEmpty');
    }
  }

  applyBlogBulkAction(): void {
    if (!this.canApplyBlogBulk()) return;
    this.blogBulkSaving = true;
    this.blogBulkError = '';
    const keys = Array.from(this.blogBulkSelection);
    const detailRequests = keys.map((key) =>
      this.admin.getContent(key).pipe(
        map((block) => ({ key, block })),
        catchError(() => of({ key, block: null }))
      )
    );
    forkJoin(detailRequests).subscribe({
      next: (rows) => {
        const updates = rows
          .map(({ key, block }) => {
            if (!block) return { key, update$: null };
            this.rememberContentVersion(key, block);
            const payload = this.buildBlogBulkPayload(block);
            if (!payload) return { key, update$: null };
            return {
              key,
              update$: this.admin.updateContentBlock(key, this.withExpectedVersion(key, payload)).pipe(
                map((res) => ({ key, res })),
                catchError((error) => of({ key, error }))
              )
            };
          })
          .filter((row) => row.update$ !== null) as Array<{ key: string; update$: any }>;

        if (!updates.length) {
          this.blogBulkSaving = false;
          this.blogBulkError = this.t('adminUi.blog.bulk.noChanges');
          return;
        }

        forkJoin(updates.map((row) => row.update$)).subscribe({
          next: (results) => {
            const failures = results.filter((r: any) => r?.error);
            const successCount = results.length - failures.length;
            if (successCount) {
              this.toast.success(this.t('adminUi.blog.bulk.success', { count: successCount }));
            }
            if (failures.length) {
              this.toast.error(this.t('adminUi.blog.bulk.errors', { count: failures.length }));
            }
            this.blogBulkSaving = false;
            this.reloadContentBlocks();
          },
          error: () => {
            this.blogBulkSaving = false;
            this.blogBulkError = this.t('adminUi.blog.bulk.errors', { count: keys.length });
          }
        });
      },
      error: () => {
        this.blogBulkSaving = false;
        this.blogBulkError = this.t('adminUi.blog.bulk.loadError');
      }
    });
  }

  extractBlogSlug(key: string): string {
    return key.startsWith('blog.') ? key.slice('blog.'.length) : key;
  }

  currentBlogSlug(): string {
    return this.selectedBlogKey ? this.extractBlogSlug(this.selectedBlogKey) : '';
  }

	  startBlogCreate(): void {
	    this.showBlogCreate = true;
	    this.selectedBlogKey = null;
	    this.blogImages = [];
	    this.showBlogCoverLibrary = false;
	    this.blogCreate = {
	      baseLang: 'en',
	      status: 'draft',
	      published_at: '',
	      published_until: '',
	      title: '',
      body_markdown: '',
	      summary: '',
	      tags: '',
	      series: '',
	      cover_image_url: '',
	      reading_time_minutes: '',
	      pinned: false,
      pin_order: String(this.nextBlogPinOrder()),
      includeTranslation: false,
      translationTitle: '',
      translationBody: ''
    };
	  }

  cancelBlogCreate(): void {
    this.showBlogCreate = false;
  }

  closeBlogEditor(): void {
    this.selectedBlogKey = null;
    this.blogImages = [];
    this.showBlogCoverLibrary = false;
    this.blogPreviewUrl = null;
    this.blogPreviewToken = null;
    this.blogPreviewExpiresAt = null;
    this.blogVersions = [];
    this.blogVersionDetail = null;
    this.blogDiffParts = [];
    this.resetBlogForm();
  }

	  async createBlogPost(): Promise<void> {
	    const baseSlug = this.blogCreateSlug();
	    if (!baseSlug) {
	      this.toast.error(this.t('adminUi.blog.errors.slugRequiredTitle'), this.t('adminUi.blog.errors.slugRequiredCopy'));
	      return;
	    }
	    if (!this.blogCreate.title.trim() || !this.blogCreate.body_markdown.trim()) {
	      this.toast.error(this.t('adminUi.blog.errors.titleBodyRequired'));
	      return;
	    }

	    const baseLang = this.blogCreate.baseLang;
	    const translationLang: 'en' | 'ro' = baseLang === 'en' ? 'ro' : 'en';
	    const meta: Record<string, any> = {};
    const summary = this.blogCreate.summary.trim();
    if (summary) {
      meta['summary'] = { [baseLang]: summary };
    }
	    const tags = this.parseTags(this.blogCreate.tags);
	    if (tags.length) {
	      meta['tags'] = tags;
	    }
	    const series = this.blogCreate.series.trim();
	    if (series) {
	      meta['series'] = series;
	    }
	    const cover = this.blogCreate.cover_image_url.trim();
	    if (cover) {
	      meta['cover_image_url'] = cover;
	    }
	    const rt = Number(String(this.blogCreate.reading_time_minutes || '').trim());
	    if (Number.isFinite(rt) && rt > 0) {
	      meta['reading_time_minutes'] = Math.trunc(rt);
	    }
	    if (this.blogCreate.pinned) {
        const rawOrder = Number(String(this.blogCreate.pin_order || '').trim());
        const normalized = Number.isFinite(rawOrder) && rawOrder > 0 ? Math.trunc(rawOrder) : this.nextBlogPinOrder();
        meta['pinned'] = true;
        meta['pin_order'] = Math.max(1, normalized);
	    }
	    const published_at = this.blogCreate.published_at ? new Date(this.blogCreate.published_at).toISOString() : undefined;
	    const published_until = this.blogCreate.published_until ? new Date(this.blogCreate.published_until).toISOString() : undefined;

	    try {
	      const payload = {
	        title: this.blogCreate.title.trim(),
	        body_markdown: this.blogCreate.body_markdown,
	        status: this.blogCreate.status,
	        lang: baseLang,
	        published_at,
	        published_until,
	        meta: Object.keys(meta).length ? meta : undefined
	      };

	      let slug = baseSlug;
	      let key = `blog.${slug}`;
	      let created = null as any;
	      for (let attempt = 0; attempt < 5; attempt += 1) {
	        try {
	          created = await firstValueFrom(this.admin.createContent(key, payload));
	          break;
	        } catch (err: any) {
	          const detail = String(err?.error?.detail || '').trim();
	          if (detail === 'Content key exists' && attempt < 4) {
	            slug = `${baseSlug}-${attempt + 2}`;
	            key = `blog.${slug}`;
	            continue;
	          }
	          throw err;
	        }
	      }
	      this.rememberContentVersion(key, created);

	      if (this.blogCreate.includeTranslation) {
        const tTitle = this.blogCreate.translationTitle.trim();
        const tBody = this.blogCreate.translationBody.trim();
        if (tTitle || tBody) {
          await firstValueFrom(
            this.admin.updateContentBlock(
              key,
              this.withExpectedVersion(key, {
                title: tTitle || this.blogCreate.title.trim(),
                body_markdown: tBody || this.blogCreate.body_markdown,
                lang: translationLang
              })
            )
          );
        }
      }

      this.toast.success(this.t('adminUi.blog.success.created'));
      this.showBlogCreate = false;
      this.reloadContentBlocks();
      this.loadBlogEditor(key);
    } catch {
      this.toast.error(this.t('adminUi.blog.errors.create'));
    }
  }

  selectBlogPost(post: AdminContent): void {
    this.showBlogCreate = false;
    this.loadBlogEditor(post.key);
  }

  deleteBlogPost(post: AdminContent): void {
    const key = (post?.key || '').trim();
    if (!key) return;
    const label = (post?.title || '').trim() || key;
    const ok = window.confirm(this.t('adminUi.blog.confirms.deletePost', { title: label }));
    if (!ok) return;

    this.blogDeleteBusy.add(key);
    this.admin.deleteContent(key).subscribe({
      next: () => {
        this.blogDeleteBusy.delete(key);
        this.blogBulkSelection.delete(key);
        if (this.selectedBlogKey === key) {
          this.closeBlogEditor();
        }
        this.toast.success(this.t('adminUi.blog.success.deleted'));
        this.reloadContentBlocks();
      },
      error: () => {
        this.blogDeleteBusy.delete(key);
        this.toast.error(this.t('adminUi.blog.errors.delete'));
      }
    });
  }

  setBlogEditLang(lang: 'en' | 'ro'): void {
    if (!this.selectedBlogKey) return;
    this.blogEditLang = lang;
    const key = this.selectedBlogKey;
    const wantsBase = lang === this.blogBaseLang;
    this.admin.getContent(key, wantsBase ? undefined : lang).subscribe({
      next: (block) => {
        this.rememberContentVersion(key, block);
        this.blogForm.title = block.title;
        this.blogForm.body_markdown = block.body_markdown;
        if (wantsBase) {
          this.blogForm.status = block.status;
        }
        this.blogForm.published_at = block.published_at ? this.toLocalDateTime(block.published_at) : '';
        this.blogForm.published_until = block.published_until ? this.toLocalDateTime(block.published_until) : '';
        this.blogMeta = block.meta || this.blogMeta || {};
        this.syncBlogMetaToForm(lang);
        this.ensureBlogDraft(key, lang).initFromServer(this.currentBlogDraftState());
        this.setBlogSeoSnapshot(lang, block.title, block.body_markdown);
      },
      error: () => this.toast.error(this.t('adminUi.blog.errors.loadContent'))
    });
  }

  saveBlogPost(): void {
    if (!this.selectedBlogKey) return;
    if (!this.blogForm.title.trim() || !this.blogForm.body_markdown.trim()) {
      this.toast.error(this.t('adminUi.blog.errors.titleBodyRequired'));
      return;
    }

    const key = this.selectedBlogKey;
    const nextMeta = this.buildBlogMeta(this.blogEditLang);
    const metaChanged = JSON.stringify(nextMeta) !== JSON.stringify(this.blogMeta || {});
    const isBase = this.blogEditLang === this.blogBaseLang;
    if (isBase && this.blogForm.status === 'published') {
      const issues = this.blogA11yIssues();
      if (issues.length) {
        this.blogA11yOpen = true;
        const ok = confirm(this.t('adminUi.blog.a11y.confirmPublishAnyway', { count: issues.length }));
        if (!ok) return;
      }
    }
    const published_at = isBase
      ? this.blogForm.published_at
        ? new Date(this.blogForm.published_at).toISOString()
        : null
      : undefined;
    const published_until = isBase
      ? this.blogForm.published_until
        ? new Date(this.blogForm.published_until).toISOString()
        : null
      : undefined;
    if (isBase) {
      const payload = this.withExpectedVersion(key, {
        title: this.blogForm.title.trim(),
        body_markdown: this.blogForm.body_markdown,
        status: this.blogForm.status as any,
        published_at,
        published_until,
        meta: nextMeta
      });
      this.admin.updateContentBlock(key, payload).subscribe({
        next: (block) => {
          this.rememberContentVersion(key, block);
          this.blogMeta = nextMeta;
          this.ensureBlogDraft(key, this.blogEditLang).markServerSaved(this.currentBlogDraftState());
          this.toast.success(this.t('adminUi.blog.success.saved'));
          this.reloadContentBlocks();
          this.loadBlogEditor(key);
        },
        error: (err) => {
          if (this.handleContentConflict(err, key, () => this.loadBlogEditor(key))) return;
          this.toast.error(this.t('adminUi.blog.errors.save'));
        }
      });
      return;
    }

    this.admin.updateContentBlock(
      key,
      this.withExpectedVersion(key, {
        title: this.blogForm.title.trim(),
        body_markdown: this.blogForm.body_markdown,
        lang: this.blogEditLang
      })
    ).subscribe({
      next: (block) => {
        this.rememberContentVersion(key, block);
        const onDone = () => {
          this.toast.success(this.t('adminUi.blog.success.translationSaved'));
          this.reloadContentBlocks();
          this.setBlogEditLang(this.blogEditLang);
        };
        if (!metaChanged) {
          this.ensureBlogDraft(key, this.blogEditLang).markServerSaved(this.currentBlogDraftState());
          onDone();
          return;
        }
        this.admin.updateContentBlock(key, this.withExpectedVersion(key, { meta: nextMeta })).subscribe({
          next: (metaBlock) => {
            this.rememberContentVersion(key, metaBlock);
            this.blogMeta = nextMeta;
            this.ensureBlogDraft(key, this.blogEditLang).markServerSaved(this.currentBlogDraftState());
            onDone();
          },
          error: (err) => {
            if (this.handleContentConflict(err, key, () => this.setBlogEditLang(this.blogEditLang))) return;
            this.toast.error(this.t('adminUi.blog.errors.translationMetaSave'));
            onDone();
          }
        });
      },
      error: (err) => {
        if (this.handleContentConflict(err, key, () => this.setBlogEditLang(this.blogEditLang))) return;
        this.toast.error(this.t('adminUi.blog.errors.translationSave'));
      }
    });
  }

  generateBlogPreviewLink(): void {
    if (!this.selectedBlogKey) return;
    const slug = this.currentBlogSlug();
    this.blog.createPreviewToken(slug, { lang: this.blogEditLang }).subscribe({
      next: (resp) => {
        this.blogPreviewUrl = resp.url;
        this.blogPreviewToken = resp.token;
        this.blogPreviewExpiresAt = resp.expires_at;
        this.toast.success(this.t('adminUi.blog.preview.success.ready'));
        void this.copyToClipboard(resp.url).then((ok) => {
          if (ok) this.toast.info(this.t('adminUi.blog.preview.success.copied'));
        });
      },
      error: () => this.toast.error(this.t('adminUi.blog.preview.errors.generate'))
    });
  }

  copyBlogPreviewLink(): void {
    if (!this.blogPreviewUrl) return;
    void this.copyToClipboard(this.blogPreviewUrl).then((ok) => {
      if (ok) this.toast.info(this.t('adminUi.blog.preview.success.copied'));
      else this.toast.error(this.t('adminUi.blog.preview.errors.copy'));
    });
  }

  pagePreviewSlug(pageKey: PageBuilderKey): string | null {
    const raw = (pageKey || '').trim();
    if (!raw.startsWith('page.')) return null;
    const slug = raw.slice('page.'.length).trim();
    return slug ? slug : null;
  }

  pagePublicPath(slug: string): string {
    const value = (slug || '').trim();
    if (!value) return '/pages';
    if (value === 'about') return '/about';
    if (value === 'contact') return '/contact';
    return `/pages/${value}`;
  }

  private previewOriginFromResponse(resp: ContentPreviewTokenResponse): string {
    const raw = (resp?.url || '').trim();
    if (!raw) return typeof window !== 'undefined' ? window.location.origin : '';
    try {
      return new URL(raw).origin;
    } catch {
      try {
        return typeof window !== 'undefined' ? new URL(raw, window.location.origin).origin : '';
      } catch {
        return typeof window !== 'undefined' ? window.location.origin : '';
      }
    }
  }

  pagePreviewShareUrl(slug: string): string | null {
    const value = (slug || '').trim();
    if (!value) return null;
    if (!this.pagePreviewToken || this.pagePreviewForSlug !== value) return null;

    const origin = (this.pagePreviewOrigin || '').trim() || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!origin) return null;

    const url = new URL(this.pagePublicPath(value), origin);
    url.searchParams.set('preview', this.pagePreviewToken);
    url.searchParams.set('lang', this.cmsPrefs.previewLang());
    url.searchParams.set('theme', this.cmsPrefs.previewTheme());
    return url.toString();
  }

  pagePreviewIframeSrc(slug: string): SafeResourceUrl | null {
    const baseUrl = this.pagePreviewShareUrl(slug);
    if (!baseUrl) return null;
    const url = new URL(baseUrl);
    url.searchParams.set('__ts', String(this.pagePreviewNonce || 0));
    return this.sanitizer.bypassSecurityTrustResourceUrl(url.toString());
  }

  generatePagePreviewLink(slug: string): void {
    const value = (slug || '').trim();
    if (!value) return;
    this.admin.createPagePreviewToken(value, { lang: this.cmsPrefs.previewLang() }).subscribe({
      next: (resp) => {
        this.pagePreviewForSlug = value;
        this.pagePreviewToken = resp.token;
        this.pagePreviewExpiresAt = resp.expires_at;
        this.pagePreviewOrigin = this.previewOriginFromResponse(resp);
        this.pagePreviewNonce = Date.now();
        const url = this.pagePreviewShareUrl(value);
        if (url) {
          this.toast.success(this.t('adminUi.content.previewLinks.success.ready'));
          void this.copyToClipboard(url).then((ok) => {
            if (ok) this.toast.info(this.t('adminUi.content.previewLinks.success.copied'));
          });
        } else {
          this.toast.success(this.t('adminUi.content.previewLinks.success.ready'));
        }
      },
      error: () => this.toast.error(this.t('adminUi.content.previewLinks.errors.generate'))
    });
  }

  refreshPagePreview(): void {
    if (!this.pagePreviewToken) return;
    this.pagePreviewNonce = Date.now();
  }

  homePreviewShareUrl(): string | null {
    if (!this.homePreviewToken) return null;
    const origin = (this.homePreviewOrigin || '').trim() || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!origin) return null;
    const url = new URL('/', origin);
    url.searchParams.set('preview', this.homePreviewToken);
    url.searchParams.set('lang', this.cmsPrefs.previewLang());
    url.searchParams.set('theme', this.cmsPrefs.previewTheme());
    return url.toString();
  }

  homePreviewIframeSrc(): SafeResourceUrl | null {
    const baseUrl = this.homePreviewShareUrl();
    if (!baseUrl) return null;
    const url = new URL(baseUrl);
    url.searchParams.set('__ts', String(this.homePreviewNonce || 0));
    return this.sanitizer.bypassSecurityTrustResourceUrl(url.toString());
  }

  generateHomePreviewLink(): void {
    this.admin.createHomePreviewToken({ lang: this.cmsPrefs.previewLang() }).subscribe({
      next: (resp) => {
        this.homePreviewToken = resp.token;
        this.homePreviewExpiresAt = resp.expires_at;
        this.homePreviewOrigin = this.previewOriginFromResponse(resp);
        this.homePreviewNonce = Date.now();
        const url = this.homePreviewShareUrl();
        if (url) {
          this.toast.success(this.t('adminUi.content.previewLinks.success.ready'));
          void this.copyToClipboard(url).then((ok) => {
            if (ok) this.toast.info(this.t('adminUi.content.previewLinks.success.copied'));
          });
        } else {
          this.toast.success(this.t('adminUi.content.previewLinks.success.ready'));
        }
      },
      error: () => this.toast.error(this.t('adminUi.content.previewLinks.errors.generate'))
    });
  }

  refreshHomePreview(): void {
    if (!this.homePreviewToken) return;
    this.homePreviewNonce = Date.now();
  }

  copyPreviewLink(url: string): void {
    const value = (url || '').trim();
    if (!value) return;
    void this.copyToClipboard(value).then((ok) => {
      if (ok) this.toast.info(this.t('adminUi.content.previewLinks.success.copied'));
      else this.toast.error(this.t('adminUi.content.previewLinks.errors.copy'));
    });
  }

  private setBlogSeoSnapshot(lang: UiLang, title: string, body_markdown: string): void {
    this.blogSeoSnapshots[lang] = { title: title || '', body_markdown: body_markdown || '' };
  }

  private loadBlogSeoSnapshots(key: string): void {
    this.blogSeoSnapshotsKey = key;
    this.blogSeoSnapshotsLoading = true;
    const langs: UiLang[] = ['en', 'ro'];
    type BlogSeoRow = { lang: UiLang; title: string; body_markdown: string; missing?: true };
    const requests = langs.map((lang) =>
      this.admin.getContent(key, lang).pipe(
        map((block) => ({ lang, title: block.title || '', body_markdown: block.body_markdown || '' } as BlogSeoRow)),
        catchError(() => of({ lang, title: '', body_markdown: '', missing: true } as BlogSeoRow))
      )
    );
    forkJoin(requests).subscribe({
      next: (rows: BlogSeoRow[]) => {
        if (this.selectedBlogKey !== key || this.blogSeoSnapshotsKey !== key) return;
        for (const row of rows) {
          const lang = row.lang;
          if (row.missing) this.blogSeoSnapshots[lang] = null;
          else this.setBlogSeoSnapshot(lang, row.title, row.body_markdown);
        }
      },
      complete: () => {
        if (this.blogSeoSnapshotsKey === key) this.blogSeoSnapshotsLoading = false;
      }
    });
  }

  blogSeoHasContent(lang: UiLang): boolean {
    if (!this.selectedBlogKey) return false;
    if (lang === this.blogEditLang) return Boolean((this.blogForm.title || '').trim() || (this.blogForm.body_markdown || '').trim());
    return Boolean(this.blogSeoSnapshots[lang]?.title || this.blogSeoSnapshots[lang]?.body_markdown);
  }

  blogSeoTitleFull(lang: UiLang): string {
    const rawTitle =
      lang === this.blogEditLang
        ? (this.blogForm.title || '').trim()
        : (this.blogSeoSnapshots[lang]?.title || '').trim();
    if (!rawTitle) return '';
    return `${rawTitle} | momentstudio`;
  }

  blogSeoDescriptionFull(lang: UiLang): string {
    return this.blogSeoDescriptionSource(lang).slice(0, 160).trim();
  }

  blogSeoTitlePreview(lang: UiLang): string {
    return this.truncateForPreview(this.blogSeoTitleFull(lang), 62);
  }

  blogSeoDescriptionPreview(lang: UiLang): string {
    return this.truncateForPreview(this.blogSeoDescriptionSource(lang), 160);
  }

  blogSeoIssues(lang: UiLang): Array<{ key: string; params?: Record<string, unknown> }> {
    const title = this.blogSeoTitleFull(lang);
    const metaDescription = this.blogSeoDescriptionFull(lang);
    const sourceDescription = this.blogSeoDescriptionSource(lang);
    const titleLen = title.length;
    const descMetaLen = metaDescription.length;
    const descSourceLen = sourceDescription.length;
    const issues: Array<{ key: string; params?: Record<string, unknown> }> = [];
    if (!title.trim()) issues.push({ key: 'adminUi.blog.seo.issues.missingTitle' });
    if (!metaDescription.trim()) issues.push({ key: 'adminUi.blog.seo.issues.missingDescription' });
    if (titleLen > 70) issues.push({ key: 'adminUi.blog.seo.issues.titleTooLong', params: { count: titleLen } });
    if (titleLen > 0 && titleLen < 25) issues.push({ key: 'adminUi.blog.seo.issues.titleTooShort', params: { count: titleLen } });
    if (descSourceLen > 160) issues.push({ key: 'adminUi.blog.seo.issues.descriptionTooLong', params: { count: descSourceLen } });
    if (descMetaLen > 0 && descMetaLen < 70) issues.push({ key: 'adminUi.blog.seo.issues.descriptionTooShort', params: { count: descMetaLen } });
    const summary = this.getBlogSummary(this.blogMeta || {}, lang);
    if (!summary.trim() && metaDescription.trim()) issues.push({ key: 'adminUi.blog.seo.issues.derivedFromBody' });
    if (!this.blogPreviewToken && this.blogForm.status !== 'published') issues.push({ key: 'adminUi.blog.seo.issues.previewTokenRecommended' });
    return issues;
  }

  private truncateForPreview(value: string, max: number): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= max) return text;
    return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
  }

  private toSeoDescription(markdownOrText: string): string {
    const cleaned = String(markdownOrText || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[#>*_~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned;
  }

  private blogSeoDescriptionSource(lang: UiLang): string {
    const summary = this.getBlogSummary(this.blogMeta || {}, lang);
    const body =
      lang === this.blogEditLang
        ? (this.blogForm.body_markdown || '').trim()
        : (this.blogSeoSnapshots[lang]?.body_markdown || '').trim();
    const source = (summary || '').trim() || body;
    return this.toSeoDescription(source);
  }

  blogPublicUrl(lang: UiLang): string {
    if (typeof window === 'undefined') return `/blog/${this.currentBlogSlug()}?lang=${lang}`;
    return `${window.location.origin}/blog/${this.currentBlogSlug()}?lang=${lang}`;
  }

  blogPublishedOgImageUrl(lang: UiLang): string {
    const apiBaseUrl = (appConfig.apiBaseUrl || '/api/v1').replace(/\/$/, '');
    const ogPath = `${apiBaseUrl}/blog/posts/${this.currentBlogSlug()}/og.png?lang=${lang}`;
    if (ogPath.startsWith('http://') || ogPath.startsWith('https://') || typeof window === 'undefined') return ogPath;
    return `${window.location.origin}${ogPath}`;
  }

  blogPreviewOgImageUrl(lang: UiLang): string | null {
    if (!this.blogPreviewToken) return null;
    const apiBaseUrl = (appConfig.apiBaseUrl || '/api/v1').replace(/\/$/, '');
    const token = encodeURIComponent(this.blogPreviewToken);
    const ogPath = `${apiBaseUrl}/blog/posts/${this.currentBlogSlug()}/og-preview.png?lang=${lang}&token=${token}`;
    if (ogPath.startsWith('http://') || ogPath.startsWith('https://') || typeof window === 'undefined') return ogPath;
    return `${window.location.origin}${ogPath}`;
  }

  copyText(text: string): void {
    const value = (text || '').trim();
    if (!value) return;
    void this.copyToClipboard(value).then((ok) => {
      if (ok) this.toast.info(this.t('adminUi.blog.social.success.copied'));
      else this.toast.error(this.t('adminUi.blog.social.errors.copy'));
    });
  }

  loadBlogVersions(): void {
    if (!this.selectedBlogKey) return;
    this.admin.listContentVersions(this.selectedBlogKey).subscribe({
      next: (items) => {
        this.blogVersions = items;
        this.blogVersionDetail = null;
        this.blogDiffParts = [];
      },
      error: () => this.toast.error(this.t('adminUi.blog.revisions.errors.load'))
    });
  }

  loadFlaggedComments(): void {
    this.flaggedCommentsLoading.set(true);
    this.flaggedCommentsError = null;
    this.blog.listFlaggedComments().subscribe({
      next: (resp) => {
        this.flaggedComments.set(resp.items || []);
      },
      error: () => {
        this.flaggedComments.set([]);
        this.flaggedCommentsError = this.t('adminUi.blog.moderation.errors.load');
      },
      complete: () => this.flaggedCommentsLoading.set(false)
    });
  }

  resolveFlags(comment: AdminBlogComment): void {
    this.blog.resolveCommentFlagsAdmin(comment.id).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.blog.moderation.success.flagsResolved'));
        this.loadFlaggedComments();
      },
      error: () => this.toast.error(this.t('adminUi.blog.moderation.errors.resolveFlags'))
    });
  }

  toggleHide(comment: AdminBlogComment): void {
    if (this.blogCommentModerationBusy.has(comment.id)) return;

    const setHidden = (value: boolean) => {
      this.flaggedComments.update((items) => items.map((c) => (c.id === comment.id ? { ...c, is_hidden: value } : c)));
    };

    if (comment.is_hidden) {
      setHidden(false);
      this.blogCommentModerationBusy.add(comment.id);
      this.blog.unhideCommentAdmin(comment.id).subscribe({
        next: () => {
          this.blogCommentModerationBusy.delete(comment.id);
          this.toast.success(this.t('adminUi.blog.moderation.success.commentUnhidden'));
          this.loadFlaggedComments();
        },
        error: () => {
          this.blogCommentModerationBusy.delete(comment.id);
          setHidden(true);
          this.toast.error(this.t('adminUi.blog.moderation.errors.unhide'));
        }
      });
      return;
    }
    const reasonPrompt = prompt(this.t('adminUi.blog.moderation.prompts.hideReason'));
    if (reasonPrompt === null) return;
    const reason = reasonPrompt || '';
    setHidden(true);
    this.blogCommentModerationBusy.add(comment.id);
    this.blog.hideCommentAdmin(comment.id, { reason: reason.trim() || null }).subscribe({
      next: () => {
        this.blogCommentModerationBusy.delete(comment.id);
        this.toast.success(this.t('adminUi.blog.moderation.success.commentHidden'));
        this.loadFlaggedComments();
      },
      error: () => {
        this.blogCommentModerationBusy.delete(comment.id);
        setHidden(false);
        this.toast.error(this.t('adminUi.blog.moderation.errors.hide'));
      }
    });
  }

  adminDeleteComment(comment: AdminBlogComment): void {
    if (this.blogCommentModerationBusy.has(comment.id)) return;
    const ok = confirm(this.t('adminUi.blog.moderation.confirms.deleteComment'));
    if (!ok) return;
    this.blog.deleteComment(comment.id).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.blog.moderation.success.commentDeleted'));
        this.loadFlaggedComments();
      },
      error: () => this.toast.error(this.t('adminUi.blog.moderation.errors.delete'))
    });
  }

  selectBlogVersion(version: number): void {
    if (!this.selectedBlogKey) return;
    this.admin.getContentVersion(this.selectedBlogKey, version).subscribe({
      next: (v) => {
        this.blogVersionDetail = v;
        this.blogDiffParts = diffLines(v.body_markdown || '', this.blogForm.body_markdown || '');
      },
      error: () => this.toast.error(this.t('adminUi.blog.revisions.errors.loadVersion'))
    });
  }

  rollbackBlogVersion(version: number): void {
    if (!this.selectedBlogKey) return;
    const ok = confirm(this.t('adminUi.blog.revisions.confirms.rollback', { version }));
    if (!ok) return;
    const key = this.selectedBlogKey;
    this.admin.rollbackContentVersion(key, version).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.blog.revisions.success.rolledBack'));
        this.reloadContentBlocks();
        this.loadBlogEditor(key);
        this.loadBlogVersions();
      },
      error: () => this.toast.error(this.t('adminUi.blog.revisions.errors.rollback'))
    });
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
      } catch {
        return false;
      }
    }
  }

  renderMarkdown(markdown: string): string {
    return this.markdown.render(markdown);
  }

  applyBlogHeading(textarea: HTMLTextAreaElement, level: 1 | 2): void {
    const prefix = `${'#'.repeat(level)} `;
    this.prefixBlogLines(textarea, prefix);
  }

  applyBlogList(textarea: HTMLTextAreaElement): void {
    this.prefixBlogLines(textarea, '- ');
  }

  wrapBlogSelection(textarea: HTMLTextAreaElement, before: string, after: string, placeholder: string): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const hasSelection = end > start;
    const selected = hasSelection ? value.slice(start, end) : placeholder;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    const selStart = start + before.length;
    const selEnd = selStart + selected.length;
    this.updateBlogBody(textarea, next, selStart, selEnd);
  }

  insertBlogLink(textarea: HTMLTextAreaElement): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const hasSelection = end > start;
    const text = hasSelection ? value.slice(start, end) : 'link text';
    const url = 'https://';
    const snippet = `[${text}](${url})`;
    const next = value.slice(0, start) + snippet + value.slice(end);
    const urlStart = start + text.length + 3;
    this.updateBlogBody(textarea, next, urlStart, urlStart + url.length);
  }

  insertBlogCodeBlock(textarea: HTMLTextAreaElement): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const hasSelection = end > start;
    const selected = hasSelection ? value.slice(start, end) : 'code';
    const snippet = `\n\`\`\`\n${selected}\n\`\`\`\n`;
    const next = value.slice(0, start) + snippet + value.slice(end);
    const codeStart = start + 5;
    this.updateBlogBody(textarea, next, codeStart, codeStart + selected.length);
  }

  insertBlogEmbed(target: HTMLTextAreaElement | RichEditorComponent, kind: 'product' | 'category' | 'collection'): void {
    const hintKey =
      kind === 'product'
        ? 'adminUi.blog.embeds.prompt.product'
        : kind === 'category'
          ? 'adminUi.blog.embeds.prompt.category'
          : 'adminUi.blog.embeds.prompt.collection';
    const raw = prompt(this.t(hintKey), '') || '';
    const slug = raw.trim();
    if (!slug) return;
    const snippet = `{{${kind}:${slug}}}`;
    if (target instanceof HTMLTextAreaElement) {
      this.insertAtCursor(target, snippet);
    } else {
      target.insertMarkdown(snippet);
    }
  }

  uploadAndInsertBlogImage(target: HTMLTextAreaElement | RichEditorComponent, event: Event): void {
    if (!this.selectedBlogKey) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.admin.uploadContentImage(this.selectedBlogKey, file).subscribe({
      next: (block) => {
        const images = (block.images || [])
          .map((img) => ({
            id: img.id,
            url: img.url,
            alt_text: img.alt_text,
            sort_order: img.sort_order ?? 0,
            focal_x: img.focal_x ?? 50,
            focal_y: img.focal_y ?? 50
          }))
          .sort((a, b) => a.sort_order - b.sort_order);
        this.blogImages = images;
        this.toast.success(this.t('adminUi.blog.images.success.uploaded'));
        const inserted = images[images.length - 1];
        if (inserted?.url) {
          const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\r\n]+/g, ' ').trim() || 'image';
          const layoutToken = this.blogImageLayout === 'default' ? '' : this.blogImageLayout;
          const snippet = layoutToken ? `![${alt}](${inserted.url} "${layoutToken}")` : `![${alt}](${inserted.url})`;
          if (target instanceof HTMLTextAreaElement) {
            this.insertAtCursor(target, snippet);
          } else {
            target.insertMarkdown(snippet);
          }
          this.toast.info(this.t('adminUi.blog.images.success.insertedMarkdown'));
        }
        input.value = '';
      },
      error: () => this.toast.error(this.t('adminUi.blog.images.errors.upload'))
    });
  }

  onBlogImageDragOver(event: DragEvent): void {
    const transfer = event?.dataTransfer;
    const types = Array.from(transfer?.types || []);
    if (!types.includes('Files')) return;
    event.preventDefault();
    if (transfer) transfer.dropEffect = 'copy';
  }

  async onBlogImageDrop(target: HTMLTextAreaElement | RichEditorComponent, event: DragEvent): Promise<void> {
    const transfer = event?.dataTransfer;
    const files = Array.from(transfer?.files || []).filter((file) => file && file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();

    if (!this.selectedBlogKey) return;
    let insertedCount = 0;

    for (const file of files) {
      try {
        const block = await firstValueFrom(this.admin.uploadContentImage(this.selectedBlogKey, file));
        const images = (block.images || [])
          .map((img) => ({
            id: img.id,
            url: img.url,
            alt_text: img.alt_text,
            sort_order: img.sort_order ?? 0,
            focal_x: img.focal_x ?? 50,
            focal_y: img.focal_y ?? 50
          }))
          .sort((a, b) => a.sort_order - b.sort_order);
        this.blogImages = images;
        const inserted = images[images.length - 1];
        if (!inserted?.url) continue;

        const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\r\n]+/g, ' ').trim() || 'image';
        const layoutToken = this.blogImageLayout === 'default' ? '' : this.blogImageLayout;
        const snippet = layoutToken ? `![${alt}](${inserted.url} "${layoutToken}")` : `![${alt}](${inserted.url})`;
        if (target instanceof HTMLTextAreaElement) {
          this.insertAtCursor(target, snippet);
        } else {
          target.insertMarkdown(snippet);
        }
        insertedCount += 1;
      } catch {
        this.toast.error(this.t('adminUi.blog.images.errors.upload'));
        return;
      }
    }

    if (insertedCount) {
      this.toast.success(this.t('adminUi.blog.images.success.uploaded'));
      this.toast.info(this.t('adminUi.blog.images.success.insertedMarkdown'));
    }
  }

  insertBlogImageMarkdown(url: string, altText?: string | null): void {
    const alt = (altText || 'image').replace(/[\r\n]+/g, ' ').trim();
    const snippet = `\n\n![${alt}](${url})\n`;
    this.blogForm.body_markdown = (this.blogForm.body_markdown || '').trimEnd() + snippet;
    this.toast.info(this.t('adminUi.blog.images.success.insertedMarkdown'));
  }

  blogA11yIssues(): Array<{ index: number; url: string; alt: string }> {
    const markdown = this.blogForm.body_markdown || '';
    const issues: Array<{ index: number; url: string; alt: string }> = [];
    const re = /!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g;
    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = re.exec(markdown))) {
      const alt = String(match[1] || '').trim();
      const url = String(match[2] || '').trim();
      const altKey = alt.toLowerCase();
      const missing = !alt || altKey === 'image' || altKey === 'photo' || altKey === 'picture';
      if (url && missing) issues.push({ index: idx, url, alt });
      idx += 1;
    }
    return issues;
  }

  promptFixBlogImageAlt(imageIndex: number): void {
    const markdown = this.blogForm.body_markdown || '';
    const re = /!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g;
    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = re.exec(markdown))) {
      if (idx !== imageIndex) {
        idx += 1;
        continue;
      }
      const url = String(match[2] || '').trim();
      const suggestion = this.suggestAltFromUrl(url);
      const next = (prompt(this.t('adminUi.blog.a11y.promptAlt'), suggestion) || '').trim();
      if (!next) return;
      this.setBlogMarkdownImageAlt(imageIndex, next);
      this.toast.success(this.t('adminUi.blog.a11y.fixed'));
      this.blogA11yOpen = true;
      return;
    }
  }

  private suggestAltFromUrl(url: string): string {
    const cleaned = String(url || '').split('?')[0].split('#')[0].trim();
    const filename = cleaned.split('/').pop() || '';
    const base = filename.replace(/\.[^.]+$/, '');
    return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'image';
  }

  private setBlogMarkdownImageAlt(imageIndex: number, alt: string): void {
    const markdown = this.blogForm.body_markdown || '';
    const safeAlt = String(alt || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!safeAlt) return;

    const re = /!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g;
    let match: RegExpExecArray | null;
    let idx = 0;
    let out = '';
    let lastIndex = 0;
    while ((match = re.exec(markdown))) {
      const start = match.index;
      const end = re.lastIndex;
      out += markdown.slice(lastIndex, start);
      if (idx === imageIndex) {
        out += `![${safeAlt}](${match[2]}${match[3]})`;
      } else {
        out += markdown.slice(start, end);
      }
      lastIndex = end;
      idx += 1;
    }
    out += markdown.slice(lastIndex);
    this.blogForm.body_markdown = out;
  }

  blogWritingAids(): { words: number; minutes: number; headings: Array<{ level: number; text: string }> } {
    const markdown = this.blogForm.body_markdown || '';
    const words = this.countMarkdownWords(markdown);
    const minutes = words ? Math.max(1, Math.ceil(words / 200)) : 0;
    return { words, minutes, headings: this.extractMarkdownHeadings(markdown) };
  }

  applyBlogReadingTimeEstimate(): void {
    const aids = this.blogWritingAids();
    if (!aids.minutes) return;
    this.blogForm.reading_time_minutes = String(aids.minutes);
    this.toast.info(this.t('adminUi.blog.writing.applied', { minutes: aids.minutes }));
  }

  private countMarkdownWords(markdown: string): number {
    const cleaned = String(markdown || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[#>*_~`-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const matches = cleaned.match(/[\p{L}\p{N}]+/gu);
    return matches?.length ?? 0;
  }

  private extractMarkdownHeadings(markdown: string): Array<{ level: number; text: string }> {
    const lines = String(markdown || '').split('\n');
    const out: Array<{ level: number; text: string }> = [];
    let inCode = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('```')) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;
      const match = /^(#{1,6})\s+(.+)$/.exec(line);
      if (!match) continue;
      const level = match[1].length;
      if (level > 3) continue;
      const text = match[2]
        .replace(/\s+#+\s*$/, '')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim();
      if (!text) continue;
      out.push({ level, text });
      if (out.length >= 40) break;
    }
    return out;
  }

  blogCoverPreviewUrl(): string | null {
    const explicit = (this.blogForm.cover_image_url || '').trim();
    if (explicit) return explicit;
    const first = this.blogImages[0];
    return first?.url ? String(first.url) : null;
  }

  blogCoverPreviewAsset():
    | { id: string; url: string; sort_order: number; focal_x: number; focal_y: number; alt_text?: string | null }
    | null {
    const url = this.blogCoverPreviewUrl();
    if (!url) return null;
    return this.blogImages.find((img) => img.url === url) ?? null;
  }

  blogCoverPreviewFocalPosition(): string {
    const img = this.blogCoverPreviewAsset();
    const x = Math.max(0, Math.min(100, Math.round(Number(img?.focal_x ?? 50))));
    const y = Math.max(0, Math.min(100, Math.round(Number(img?.focal_y ?? 50))));
    return `${x}% ${y}%`;
  }

  clearBlogCoverOverride(): void {
    this.blogForm.cover_image_url = '';
  }

  uploadBlogCoverImage(event: Event): void {
    if (!this.selectedBlogKey) return;
    if (this.blogEditLang !== this.blogBaseLang) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.admin.uploadContentImage(this.selectedBlogKey, file).subscribe({
      next: (block) => {
        const images = (block.images || [])
          .map((img) => ({
            id: img.id,
            url: img.url,
            alt_text: img.alt_text,
            sort_order: img.sort_order ?? 0,
            focal_x: img.focal_x ?? 50,
            focal_y: img.focal_y ?? 50
          }))
          .sort((a, b) => a.sort_order - b.sort_order);
        this.blogImages = images;
        const inserted = images[images.length - 1];
        if (inserted?.url) {
          this.blogForm.cover_image_url = inserted.url;
        }
        this.toast.success(this.t('adminUi.blog.images.success.uploaded'));
        input.value = '';
      },
      error: () => this.toast.error(this.t('adminUi.blog.images.errors.upload'))
    });
  }

  selectBlogCoverAsset(asset: ContentImageAssetRead): void {
    const url = (asset?.url || '').trim();
    if (!url) return;
    if (this.blogEditLang !== this.blogBaseLang) return;
    this.blogForm.cover_image_url = url;
    const id = String(asset.id || '').trim();
    if (!id) return;
    const next = [...this.blogImages];
    const idx = next.findIndex((img) => img.id === id);
    const row = {
      id,
      url,
      alt_text: asset.alt_text ?? null,
      sort_order: Number.isFinite(asset.sort_order as any) ? Number(asset.sort_order) : 0,
      focal_x: Number.isFinite(asset.focal_x as any) ? Number(asset.focal_x) : 50,
      focal_y: Number.isFinite(asset.focal_y as any) ? Number(asset.focal_y) : 50
    };
    if (idx >= 0) next[idx] = { ...next[idx], ...row };
    else next.push(row);
    next.sort((a, b) => a.sort_order - b.sort_order);
    this.blogImages = next;
    this.showBlogCoverLibrary = false;
  }

  editBlogCoverFocalPoint(): void {
    if (this.blogEditLang !== this.blogBaseLang) return;
    const img = this.blogCoverPreviewAsset();
    if (!img) return;
    const entered = window.prompt(this.t('adminUi.site.assets.library.focalPrompt'), `${img.focal_x}, ${img.focal_y}`);
    if (entered === null) return;
    const parts = entered
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length < 2) {
      this.toast.error(this.t('adminUi.site.assets.library.focalErrorsFormat'));
      return;
    }
    const focalX = Math.max(0, Math.min(100, Math.round(Number(parts[0]))));
    const focalY = Math.max(0, Math.min(100, Math.round(Number(parts[1]))));
    if (!Number.isFinite(focalX) || !Number.isFinite(focalY)) {
      this.toast.error(this.t('adminUi.site.assets.library.focalErrorsFormat'));
      return;
    }
    this.admin.updateContentImageFocalPoint(img.id, focalX, focalY).subscribe({
      next: (updated) => {
        this.blogImages = this.blogImages.map((item) =>
          item.id === img.id ? { ...item, focal_x: updated.focal_x, focal_y: updated.focal_y } : item
        );
        this.toast.success(this.t('adminUi.site.assets.library.focalSaved'));
      },
      error: () => this.toast.error(this.t('adminUi.site.assets.library.focalErrorsSave'))
    });
  }

  private prefixBlogLines(textarea: HTMLTextAreaElement, prefix: string): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = end === start ? value.indexOf('\n', start) : value.indexOf('\n', end);
    const safeLineEnd = lineEnd === -1 ? value.length : lineEnd;
    const segment = value.slice(lineStart, safeLineEnd);
    const lines = segment.split('\n');
    const nextSegment = lines
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (line.startsWith(prefix)) return line;
        return prefix + line;
      })
      .join('\n');
    const nextValue = value.slice(0, lineStart) + nextSegment + value.slice(safeLineEnd);
    const added = nextSegment.length - segment.length;
    this.updateBlogBody(textarea, nextValue, start + added, end + added);
  }

  private insertAtCursor(textarea: HTMLTextAreaElement, text: string): void {
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const next = value.slice(0, start) + text + value.slice(end);
    const pos = start + text.length;
    this.updateBlogBody(textarea, next, pos, pos);
  }

  private updateBlogBody(textarea: HTMLTextAreaElement, nextValue: string, selectionStart: number, selectionEnd: number): void {
    this.blogForm.body_markdown = nextValue;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  private loadBlogEditor(key: string): void {
    this.selectedBlogKey = key;
    this.resetBlogForm();
    this.showBlogCoverLibrary = false;
    this.blogPreviewUrl = null;
    this.blogPreviewExpiresAt = null;
    this.blogVersions = [];
    this.blogVersionDetail = null;
    this.blogDiffParts = [];
    this.admin.getContent(key).subscribe({
      next: (block) => {
        this.rememberContentVersion(key, block);
        this.blogBaseLang = block.lang === 'ro' ? 'ro' : 'en';
        this.blogEditLang = this.blogBaseLang;
        this.blogMeta = block.meta || {};
	        this.blogForm = {
	          title: block.title,
	          body_markdown: block.body_markdown,
	          status: block.status,
	          published_at: block.published_at ? this.toLocalDateTime(block.published_at) : '',
	          published_until: block.published_until ? this.toLocalDateTime(block.published_until) : '',
	          summary: '',
	          tags: '',
	          series: '',
	          cover_image_url: '',
            cover_fit: 'cover',
	          reading_time_minutes: '',
	          pinned: false,
	          pin_order: '1'
	        };
        this.syncBlogMetaToForm(this.blogEditLang);
        this.ensureBlogDraft(key, this.blogEditLang).initFromServer(this.currentBlogDraftState());
        this.loadBlogSeoSnapshots(key);
        const images = (block.images || [])
          .map((img) => ({
            id: img.id,
            url: img.url,
            alt_text: img.alt_text,
            sort_order: img.sort_order ?? 0,
            focal_x: img.focal_x ?? 50,
            focal_y: img.focal_y ?? 50
          }))
          .sort((a, b) => a.sort_order - b.sort_order);
        this.blogImages = [...images];
        this.loadBlogVersions();
      },
      error: () => this.toast.error(this.t('adminUi.blog.errors.loadPost'))
    });
  }

  private reloadContentBlocks(): void {
    this.admin.content().subscribe({
      next: (c) => {
        const nextBlocks = Array.isArray(c) ? [...c] : [];
        this.contentBlocks = nextBlocks;
        this.syncContentVersions(nextBlocks);
        this.pruneBlogBulkSelection();
      },
      error: () => {
        this.contentBlocks = [];
      }
    });
  }

  private resetBlogForm(): void {
	    this.blogForm = {
	      title: '',
	      body_markdown: '',
	      status: 'draft',
	      published_at: '',
	      published_until: '',
	      summary: '',
	      tags: '',
	      series: '',
	      cover_image_url: '',
        cover_fit: 'cover',
	      reading_time_minutes: '',
	      pinned: false,
	      pin_order: '1'
	    };
    this.blogMeta = {};
  }

	  private normalizeBlogSlug(raw: string): string {
	    return raw
	      .normalize('NFD')
	      .replace(/[\u0300-\u036f]/g, '')
	      .trim()
	      .toLowerCase()
	      .replace(/\s+/g, '-')
	      .replace(/[^a-z0-9-]/g, '')
	      .replace(/-+/g, '-')
	      .replace(/^-|-$/g, '');
	  }

	  blogCreateSlug(): string {
	    return this.normalizeBlogSlug(this.blogCreate.title || '');
	  }

  private parseTags(raw: string): string[] {
    const parts = (raw || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of parts) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(part);
    }
    return out;
  }

  private toIsoFromLocal(value: string): string | null {
    const trimmed = (value || '').trim();
    if (!trimmed) return null;
    const date = new Date(trimmed);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toISOString();
  }

  private buildBlogBulkPayload(block: { meta?: Record<string, any> | null }): Record<string, unknown> | null {
    switch (this.blogBulkAction) {
      case 'publish':
        return { status: 'published', published_at: null };
      case 'unpublish':
        return { status: 'draft' };
      case 'schedule': {
        const publishIso = this.toIsoFromLocal(this.blogBulkPublishAt);
        if (!publishIso) return null;
        const unpublishIso = this.toIsoFromLocal(this.blogBulkUnpublishAt);
        if (unpublishIso && new Date(unpublishIso).getTime() <= new Date(publishIso).getTime()) {
          this.blogBulkError = this.t('adminUi.blog.bulk.invalidSchedule');
          return null;
        }
        return {
          status: 'published',
          published_at: publishIso,
          published_until: unpublishIso ?? null
        };
      }
      case 'tags_add':
      case 'tags_remove': {
        const tagsInput = this.parseTags(this.blogBulkTags);
        if (!tagsInput.length) return null;
        const meta = { ...(block.meta || {}) } as Record<string, unknown>;
        const existingRaw = meta['tags'];
        const existing = Array.isArray(existingRaw)
          ? existingRaw.map((t) => String(t))
          : typeof existingRaw === 'string'
          ? this.parseTags(existingRaw)
          : [];
        const merged = this.blogBulkAction === 'tags_add' ? this.mergeTags(existing, tagsInput) : this.removeTags(existing, tagsInput);
        if (merged.length) meta['tags'] = merged;
        else delete meta['tags'];
        return { meta };
      }
      default:
        return null;
    }
  }

  private mergeTags(existing: string[], incoming: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of [...existing, ...incoming]) {
      const trimmed = String(value || '').trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  }

  private removeTags(existing: string[], remove: string[]): string[] {
    const removeSet = new Set(remove.map((t) => String(t || '').trim().toLowerCase()).filter(Boolean));
    return existing.filter((t) => !removeSet.has(String(t || '').trim().toLowerCase()));
  }

  private pruneBlogBulkSelection(): void {
    const blogKeys = new Set(this.blogPosts().map((p) => p.key));
    for (const key of Array.from(this.blogBulkSelection)) {
      if (!blogKeys.has(key)) this.blogBulkSelection.delete(key);
    }
  }

  private syncContentVersions(blocks: AdminContent[]): void {
    blocks.forEach((block) => this.rememberContentVersion(block.key, block));
  }

  private getBlogSummary(meta: Record<string, any>, lang: 'en' | 'ro'): string {
    const summary = meta?.['summary'];
    if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
      const value = summary[lang];
      return typeof value === 'string' ? value : '';
    }
    if (typeof summary === 'string') {
      return lang === this.blogBaseLang ? summary : '';
    }
    return '';
  }

  private syncBlogMetaToForm(lang: 'en' | 'ro'): void {
    const meta = this.blogMeta || {};
    this.blogForm.summary = this.getBlogSummary(meta, lang);
    const tags = meta['tags'];
    if (Array.isArray(tags)) {
      this.blogForm.tags = tags.join(', ');
    } else if (typeof tags === 'string') {
      this.blogForm.tags = tags;
	    } else {
	      this.blogForm.tags = '';
	    }

	    const series = meta['series'];
	    this.blogForm.series = typeof series === 'string' ? series : '';

	    const cover = meta['cover_image_url'] || meta['cover_image'] || '';
	    this.blogForm.cover_image_url = typeof cover === 'string' ? cover : '';
    const coverFit = typeof meta['cover_fit'] === 'string' ? String(meta['cover_fit']).trim().toLowerCase() : '';
    this.blogForm.cover_fit = coverFit === 'contain' ? 'contain' : 'cover';
    const rt = meta['reading_time_minutes'] ?? meta['reading_time'] ?? '';
    this.blogForm.reading_time_minutes = rt ? String(rt) : '';

    const pinned = meta['pinned'];
    let pinnedFlag = false;
    if (typeof pinned === 'boolean') pinnedFlag = pinned;
    else if (typeof pinned === 'number') pinnedFlag = pinned === 1;
    else if (typeof pinned === 'string') pinnedFlag = ['1', 'true', 'yes', 'on'].includes(pinned.trim().toLowerCase());
    this.blogForm.pinned = pinnedFlag;
    const rawPinOrder = meta['pin_order'];
    const parsedPinOrder = Number(
      typeof rawPinOrder === 'number' ? rawPinOrder : typeof rawPinOrder === 'string' ? rawPinOrder.trim() : '1'
    );
    const normalized = Number.isFinite(parsedPinOrder) && parsedPinOrder > 0 ? Math.trunc(parsedPinOrder) : 1;
    this.blogForm.pin_order = String(Math.max(1, normalized));
  }

  private buildBlogMeta(lang: 'en' | 'ro'): Record<string, any> {
    const meta: Record<string, any> = { ...(this.blogMeta || {}) };

	    const tags = this.parseTags(this.blogForm.tags);
	    if (tags.length) meta['tags'] = tags;
	    else delete meta['tags'];

	    const series = this.blogForm.series.trim();
	    if (series) meta['series'] = series;
	    else delete meta['series'];

	    const cover = this.blogForm.cover_image_url.trim();
	    if (cover) meta['cover_image_url'] = cover;
	    else delete meta['cover_image_url'];
    if (this.blogForm.cover_fit === 'contain') meta['cover_fit'] = 'contain';
    else delete meta['cover_fit'];

    const rt = Number(String(this.blogForm.reading_time_minutes || '').trim());
    if (Number.isFinite(rt) && rt > 0) meta['reading_time_minutes'] = Math.trunc(rt);
    else delete meta['reading_time_minutes'];

    const summaryValue = this.blogForm.summary.trim();
    const existing = meta['summary'];
    let summary: Record<string, any> = {};
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      summary = { ...existing };
    } else if (typeof existing === 'string' && existing.trim()) {
      summary = { [this.blogBaseLang]: existing.trim() };
    }
    if (summaryValue) summary[lang] = summaryValue;
    else delete summary[lang];
    if (Object.keys(summary).length) meta['summary'] = summary;
    else delete meta['summary'];

    if (this.blogForm.pinned) {
      meta['pinned'] = true;
      const rawOrder = Number(String(this.blogForm.pin_order || '').trim());
      const normalized = Number.isFinite(rawOrder) && rawOrder > 0 ? Math.trunc(rawOrder) : 1;
      meta['pin_order'] = Math.max(1, normalized);
    } else {
      delete meta['pinned'];
      delete meta['pin_order'];
    }

    return meta;
  }

  loadAssets(): void {
    this.assetsError = null;
    this.assetsMessage = null;
    this.admin.getContent('site.assets').subscribe({
      next: (block) => {
        this.rememberContentVersion('site.assets', block);
        this.assetsForm = {
          logo_url: block.meta?.['logo_url'] || '',
          favicon_url: block.meta?.['favicon_url'] || '',
          social_image_url: block.meta?.['social_image_url'] || ''
        };
        this.assetsMessage = null;
      },
      error: () => {
        delete this.contentVersions['site.assets'];
        this.assetsForm = { logo_url: '', favicon_url: '', social_image_url: '' };
      }
    });
  }

  loadCheckoutSettings(): void {
    this.checkoutSettingsError = null;
    this.checkoutSettingsMessage = null;
    this.admin.getContent('site.checkout').subscribe({
      next: (block) => {
        this.rememberContentVersion('site.checkout', block);
        const meta = (block.meta || {}) as Record<string, any>;
        const parseBool = (value: any, fallback: boolean) => {
          if (typeof value === 'boolean') return value;
          if (typeof value === 'number') return Boolean(value);
          if (typeof value === 'string') {
            const v = value.trim().toLowerCase();
            if (['1', 'true', 'yes', 'on'].includes(v)) return true;
            if (['0', 'false', 'no', 'off'].includes(v)) return false;
          }
          return fallback;
        };
        const shipping = Number(meta['shipping_fee_ron']);
        const threshold = Number(meta['free_shipping_threshold_ron']);
        const phoneRequiredHome = parseBool(meta['phone_required_home'], true);
        const phoneRequiredLocker = parseBool(meta['phone_required_locker'], true);
        const feeEnabled = parseBool(meta['fee_enabled'], false);
        const feeTypeRaw = String(meta['fee_type'] ?? 'flat').trim().toLowerCase();
        const feeType = feeTypeRaw === 'percent' ? 'percent' : 'flat';
        const feeValueRaw = Number(meta['fee_value']);
        const feeValue = Number.isFinite(feeValueRaw) && feeValueRaw >= 0 ? feeValueRaw : 0;
        const vatEnabled = parseBool(meta['vat_enabled'], true);
        const vatRateRaw = Number(meta['vat_rate_percent']);
        const vatRate = Number.isFinite(vatRateRaw) && vatRateRaw >= 0 && vatRateRaw <= 100 ? vatRateRaw : 10;
        const vatApplyToShipping = parseBool(meta['vat_apply_to_shipping'], false);
        const vatApplyToFee = parseBool(meta['vat_apply_to_fee'], false);
        const receiptDaysRaw = Number(meta['receipt_share_days']);
        const receiptShareDays =
          Number.isFinite(receiptDaysRaw) && receiptDaysRaw >= 1 && receiptDaysRaw <= 3650 ? Math.trunc(receiptDaysRaw) : 365;
        const roundingRaw = String(meta['money_rounding'] ?? 'half_up').trim().toLowerCase();
        const moneyRounding: 'half_up' | 'half_even' | 'up' | 'down' =
          roundingRaw === 'half_even' || roundingRaw === 'up' || roundingRaw === 'down' ? roundingRaw : 'half_up';
        this.checkoutSettingsForm = {
          shipping_fee_ron: Number.isFinite(shipping) && shipping >= 0 ? shipping : 20,
          free_shipping_threshold_ron: Number.isFinite(threshold) && threshold >= 0 ? threshold : 300,
          phone_required_home: phoneRequiredHome,
          phone_required_locker: phoneRequiredLocker,
          fee_enabled: feeEnabled,
          fee_type: feeType,
          fee_value: feeValue,
          vat_enabled: vatEnabled,
          vat_rate_percent: vatRate,
          vat_apply_to_shipping: vatApplyToShipping,
          vat_apply_to_fee: vatApplyToFee,
          receipt_share_days: receiptShareDays,
          money_rounding: moneyRounding
        };
      },
      error: () => {
        delete this.contentVersions['site.checkout'];
        this.checkoutSettingsForm = {
          shipping_fee_ron: 20,
          free_shipping_threshold_ron: 300,
          phone_required_home: true,
          phone_required_locker: true,
          fee_enabled: false,
          fee_type: 'flat',
          fee_value: 0,
          vat_enabled: true,
          vat_rate_percent: 10,
          vat_apply_to_shipping: false,
          vat_apply_to_fee: false,
          receipt_share_days: 365,
          money_rounding: 'half_up'
        };
      }
    });
  }

  saveCheckoutSettings(): void {
    this.checkoutSettingsMessage = null;
    this.checkoutSettingsError = null;
    const shippingRaw = Number(this.checkoutSettingsForm.shipping_fee_ron);
    const thresholdRaw = Number(this.checkoutSettingsForm.free_shipping_threshold_ron);
    const shipping = Number.isFinite(shippingRaw) && shippingRaw >= 0 ? Math.round(shippingRaw * 100) / 100 : 20;
    const threshold = Number.isFinite(thresholdRaw) && thresholdRaw >= 0 ? Math.round(thresholdRaw * 100) / 100 : 300;

    const phoneRequiredHome = Boolean(this.checkoutSettingsForm.phone_required_home);
    const phoneRequiredLocker = Boolean(this.checkoutSettingsForm.phone_required_locker);

    const feeEnabled = Boolean(this.checkoutSettingsForm.fee_enabled);
    const feeType = this.checkoutSettingsForm.fee_type === 'percent' ? 'percent' : 'flat';
    const feeValueRaw = Number(this.checkoutSettingsForm.fee_value);
    const feeValue = Number.isFinite(feeValueRaw) && feeValueRaw >= 0 ? Math.round(feeValueRaw * 100) / 100 : 0;

    const vatEnabled = Boolean(this.checkoutSettingsForm.vat_enabled);
    const vatRateRaw = Number(this.checkoutSettingsForm.vat_rate_percent);
    const vatRate =
      Number.isFinite(vatRateRaw) && vatRateRaw >= 0 && vatRateRaw <= 100 ? Math.round(vatRateRaw * 100) / 100 : 10;
    const vatApplyToShipping = Boolean(this.checkoutSettingsForm.vat_apply_to_shipping);
    const vatApplyToFee = Boolean(this.checkoutSettingsForm.vat_apply_to_fee);

    const receiptDaysRaw = Number(this.checkoutSettingsForm.receipt_share_days);
    const receiptShareDays =
      Number.isFinite(receiptDaysRaw) && receiptDaysRaw >= 1 && receiptDaysRaw <= 3650 ? Math.trunc(receiptDaysRaw) : 365;

    const roundingRaw = String(this.checkoutSettingsForm.money_rounding || 'half_up').trim().toLowerCase();
    const moneyRounding: 'half_up' | 'half_even' | 'up' | 'down' =
      roundingRaw === 'half_even' || roundingRaw === 'up' || roundingRaw === 'down' ? roundingRaw : 'half_up';

    const payload = {
      title: 'Checkout settings',
      body_markdown:
        'Checkout pricing settings (shipping, discounts, VAT, additional fees, and receipt sharing).',
      status: 'published',
      meta: {
        version: 1,
        shipping_fee_ron: shipping,
        free_shipping_threshold_ron: threshold,
        phone_required_home: phoneRequiredHome,
        phone_required_locker: phoneRequiredLocker,
        fee_enabled: feeEnabled,
        fee_type: feeType,
        fee_value: feeValue,
        vat_enabled: vatEnabled,
        vat_rate_percent: vatRate,
        vat_apply_to_shipping: vatApplyToShipping,
        vat_apply_to_fee: vatApplyToFee,
        receipt_share_days: receiptShareDays,
        money_rounding: moneyRounding
      }
    };

    const onSuccess = (block?: { version?: number } | null) => {
      this.rememberContentVersion('site.checkout', block);
      this.checkoutSettingsMessage = this.t('adminUi.site.checkout.success.save');
      this.checkoutSettingsError = null;
    };

    this.admin.updateContentBlock('site.checkout', this.withExpectedVersion('site.checkout', payload)).subscribe({
      next: (block) => onSuccess(block),
      error: (err) => {
        if (this.handleContentConflict(err, 'site.checkout', () => this.loadCheckoutSettings())) {
          this.checkoutSettingsError = this.t('adminUi.site.checkout.errors.save');
          this.checkoutSettingsMessage = null;
          return;
        }
        this.admin.createContent('site.checkout', payload).subscribe({
          next: (created) => onSuccess(created),
          error: () => {
            this.checkoutSettingsError = this.t('adminUi.site.checkout.errors.save');
            this.checkoutSettingsMessage = null;
          }
        });
      }
    });
  }

  loadReportsSettings(): void {
    this.reportsSettingsError = null;
    this.reportsSettingsMessage = null;
    this.reportsWeeklyLastSent = null;
    this.reportsWeeklyLastError = null;
    this.reportsMonthlyLastSent = null;
    this.reportsMonthlyLastError = null;
    this.admin.getContent('site.reports').subscribe({
      next: (block) => {
        this.rememberContentVersion('site.reports', block);
        const meta = (block.meta || {}) as Record<string, any>;
        this.reportsSettingsMeta = { ...meta };

        const parseBool = (value: any, fallback: boolean) => {
          if (typeof value === 'boolean') return value;
          if (typeof value === 'number') return Boolean(value);
          if (typeof value === 'string') {
            const v = value.trim().toLowerCase();
            if (['1', 'true', 'yes', 'on'].includes(v)) return true;
            if (['0', 'false', 'no', 'off'].includes(v)) return false;
          }
          return fallback;
        };

        const parseIntSafe = (value: any, fallback: number) => {
          const n = Number(value);
          return Number.isFinite(n) ? Math.trunc(n) : fallback;
        };

        this.reportsSettingsForm.weekly_enabled = parseBool(meta['reports_weekly_enabled'], false);
        this.reportsSettingsForm.weekly_weekday = Math.min(6, Math.max(0, parseIntSafe(meta['reports_weekly_weekday'], 0)));
        this.reportsSettingsForm.weekly_hour_utc = Math.min(23, Math.max(0, parseIntSafe(meta['reports_weekly_hour_utc'], 8)));
        this.reportsSettingsForm.monthly_enabled = parseBool(meta['reports_monthly_enabled'], false);
        this.reportsSettingsForm.monthly_day = String(
          Math.min(28, Math.max(1, parseIntSafe(meta['reports_monthly_day'], 1)))
        );
        this.reportsSettingsForm.monthly_hour_utc = Math.min(23, Math.max(0, parseIntSafe(meta['reports_monthly_hour_utc'], 8)));

        const rawRecipients = meta['reports_recipients'];
        let recipients: string[] = [];
        if (Array.isArray(rawRecipients)) {
          recipients = rawRecipients.map((v) => String(v || '').trim()).filter(Boolean);
        } else if (typeof rawRecipients === 'string') {
          recipients = rawRecipients
            .split(/[,;\n]+/)
            .map((v) => String(v || '').trim())
            .filter(Boolean);
        }
        this.reportsSettingsForm.recipients = recipients.join(', ');

        this.reportsWeeklyLastSent = meta['reports_weekly_last_sent_period_end']
          ? String(meta['reports_weekly_last_sent_period_end'])
          : null;
        this.reportsWeeklyLastError = meta['reports_weekly_last_error'] ? String(meta['reports_weekly_last_error']) : null;
        this.reportsMonthlyLastSent = meta['reports_monthly_last_sent_period_end']
          ? String(meta['reports_monthly_last_sent_period_end'])
          : null;
        this.reportsMonthlyLastError = meta['reports_monthly_last_error'] ? String(meta['reports_monthly_last_error']) : null;
      },
      error: () => {
        delete this.contentVersions['site.reports'];
        this.reportsSettingsMeta = {};
        this.reportsSettingsForm = {
          weekly_enabled: false,
          weekly_weekday: 0,
          weekly_hour_utc: 8,
          monthly_enabled: false,
          monthly_day: 1,
          monthly_hour_utc: 8,
          recipients: ''
        };
      }
    });
  }

  saveReportsSettings(): void {
    this.reportsSettingsMessage = null;
    this.reportsSettingsError = null;

    const meta: Record<string, any> = { ...(this.reportsSettingsMeta || {}) };
    meta['reports_weekly_enabled'] = Boolean(this.reportsSettingsForm.weekly_enabled);
    meta['reports_weekly_weekday'] = Math.min(6, Math.max(0, Number(this.reportsSettingsForm.weekly_weekday || 0)));
    meta['reports_weekly_hour_utc'] = Math.min(23, Math.max(0, Number(this.reportsSettingsForm.weekly_hour_utc || 0)));
    meta['reports_monthly_enabled'] = Boolean(this.reportsSettingsForm.monthly_enabled);
    const monthlyDayRaw = Number(String(this.reportsSettingsForm.monthly_day || '').trim());
    meta['reports_monthly_day'] = Number.isFinite(monthlyDayRaw) ? Math.min(28, Math.max(1, Math.trunc(monthlyDayRaw))) : 1;
    meta['reports_monthly_hour_utc'] = Math.min(23, Math.max(0, Number(this.reportsSettingsForm.monthly_hour_utc || 0)));

    const recipients = String(this.reportsSettingsForm.recipients || '')
      .split(/[,;\n]+/)
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
      .filter((email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
    const uniqueRecipients = Array.from(new Set(recipients));
    if (uniqueRecipients.length) meta['reports_recipients'] = uniqueRecipients;
    else delete meta['reports_recipients'];

    if (!('reports_top_products_limit' in meta)) meta['reports_top_products_limit'] = 5;
    if (!('reports_low_stock_limit' in meta)) meta['reports_low_stock_limit'] = 20;
    if (!('reports_retry_cooldown_minutes' in meta)) meta['reports_retry_cooldown_minutes'] = 60;

    const payload = {
      title: 'Reports settings',
      body_markdown: 'Admin scheduled email reports (weekly/monthly summaries).',
      status: 'published',
      meta
    };

    const onSuccess = (block?: { version?: number; meta?: Record<string, any> | null } | null) => {
      this.rememberContentVersion('site.reports', block);
      this.reportsSettingsMeta = { ...(block?.meta || meta) };
      this.reportsSettingsMessage = this.t('adminUi.reports.success.save');
      this.reportsSettingsError = null;
    };

    this.admin.updateContentBlock('site.reports', this.withExpectedVersion('site.reports', payload)).subscribe({
      next: (block) => onSuccess(block),
      error: (err) => {
        if (this.handleContentConflict(err, 'site.reports', () => this.loadReportsSettings())) {
          this.reportsSettingsError = this.t('adminUi.reports.errors.save');
          this.reportsSettingsMessage = null;
          return;
        }
        this.admin.createContent('site.reports', payload).subscribe({
          next: (created) => onSuccess(created),
          error: () => {
            this.reportsSettingsError = this.t('adminUi.reports.errors.save');
            this.reportsSettingsMessage = null;
          }
        });
      }
    });
  }

  sendReportNow(kind: 'weekly' | 'monthly', force = false): void {
    if (this.reportsSending) return;
    this.reportsSending = true;
    this.reportsSettingsError = null;
    this.reportsSettingsMessage = null;
    this.admin.sendScheduledReport({ kind, force }).subscribe({
      next: (res) => {
        this.reportsSending = false;
        this.reportsSettingsMessage = res.skipped ? this.t('adminUi.reports.success.skipped') : this.t('adminUi.reports.success.sent');
        this.loadReportsSettings();
      },
      error: () => {
        this.reportsSending = false;
        this.reportsSettingsError = this.t('adminUi.reports.errors.send');
      }
    });
  }

	  saveAssets(): void {
	    const payload = {
	      title: 'Site assets',
	      status: 'published',
	      meta: { ...this.assetsForm }
	    };
	    const onSuccess = (block?: { version?: number } | null) => {
        this.rememberContentVersion('site.assets', block);
	      this.assetsMessage = this.t('adminUi.site.assets.success.save');
	      this.assetsError = null;
	    };
	    this.admin.updateContentBlock('site.assets', this.withExpectedVersion('site.assets', payload)).subscribe({
	      next: (block) => onSuccess(block),
	      error: (err) => {
          if (this.handleContentConflict(err, 'site.assets', () => this.loadAssets())) {
            this.assetsError = this.t('adminUi.site.assets.errors.save');
            this.assetsMessage = null;
            return;
          }
	        this.admin.createContent('site.assets', payload).subscribe({
	          next: (created) => onSuccess(created),
	          error: () => {
	            this.assetsError = this.t('adminUi.site.assets.errors.save');
	            this.assetsMessage = null;
	          }
	        })
        }
	    });
		  }

  loadCompany(): void {
    this.companyError = null;
    this.companyMessage = null;
    this.admin.getContent('site.company').subscribe({
      next: (block) => {
        this.rememberContentVersion('site.company', block);
        const meta = (block.meta || {}) as Record<string, any>;
        const company = (meta['company'] || {}) as Record<string, any>;
        this.companyForm = {
          name: String(company['name'] || '').trim(),
          registration_number: String(company['registration_number'] || '').trim(),
          cui: String(company['cui'] || '').trim(),
          address: String(company['address'] || '').trim(),
          phone: String(company['phone'] || '').trim(),
          email: String(company['email'] || '').trim()
        };
        this.companyMessage = null;
      },
      error: () => {
        delete this.contentVersions['site.company'];
        this.companyForm = {
          name: '',
          registration_number: '',
          cui: '',
          address: '',
          phone: '',
          email: ''
        };
      }
    });
  }

  companyMissingFields(): string[] {
    const missing: string[] = [];
    if (!(this.companyForm.name || '').trim()) missing.push('adminUi.site.company.fields.name');
    if (!(this.companyForm.registration_number || '').trim()) missing.push('adminUi.site.company.fields.registrationNumber');
    if (!(this.companyForm.cui || '').trim()) missing.push('adminUi.site.company.fields.cui');
    if (!(this.companyForm.address || '').trim()) missing.push('adminUi.site.company.fields.address');
    if (!(this.companyForm.phone || '').trim()) missing.push('adminUi.site.company.fields.phone');
    if (!(this.companyForm.email || '').trim()) missing.push('adminUi.site.company.fields.email');
    return missing;
  }

  saveCompany(): void {
    this.companyMessage = null;
    this.companyError = null;
    if (this.companyMissingFields().length) {
      this.companyError = this.t('adminUi.site.company.errors.required');
      return;
    }
    const payload = {
      title: 'Company information',
      body_markdown: 'Company identification details (used in footer).',
      status: 'published',
      meta: {
        version: 1,
        company: {
          name: (this.companyForm.name || '').trim(),
          registration_number: (this.companyForm.registration_number || '').trim(),
          cui: (this.companyForm.cui || '').trim(),
          address: (this.companyForm.address || '').trim(),
          phone: (this.companyForm.phone || '').trim(),
          email: (this.companyForm.email || '').trim()
        }
      }
    };
    const onSuccess = (block?: { version?: number } | null) => {
      this.rememberContentVersion('site.company', block);
      this.companyMessage = this.t('adminUi.site.company.success.save');
      this.companyError = null;
    };
    this.admin.updateContentBlock('site.company', this.withExpectedVersion('site.company', payload)).subscribe({
      next: (block) => onSuccess(block),
      error: (err) => {
        if (this.handleContentConflict(err, 'site.company', () => this.loadCompany())) {
          this.companyError = this.t('adminUi.site.company.errors.save');
          this.companyMessage = null;
          return;
        }
        this.admin.createContent('site.company', payload).subscribe({
          next: (created) => onSuccess(created),
          error: () => {
            this.companyError = this.t('adminUi.site.company.errors.save');
            this.companyMessage = null;
          }
        });
      }
    });
  }

	  loadSocial(): void {
	    this.socialError = null;
	    this.socialMessage = null;
	    this.admin.getContent('site.social').subscribe({
	      next: (block) => {
        this.rememberContentVersion('site.social', block);
        const meta = (block.meta || {}) as Record<string, any>;
        const contact = (meta['contact'] || {}) as Record<string, any>;
        this.socialForm.phone = String(contact['phone'] || this.socialForm.phone || '').trim();
        this.socialForm.email = String(contact['email'] || this.socialForm.email || '').trim();
        this.socialForm.instagram_pages = this.parseSocialPages(meta['instagram_pages'], this.socialForm.instagram_pages);
        this.socialForm.facebook_pages = this.parseSocialPages(meta['facebook_pages'], this.socialForm.facebook_pages);
      },
      error: () => {
        delete this.contentVersions['site.social'];
        // Keep defaults.
      }
    });
  }

  addSocialLink(platform: 'instagram' | 'facebook'): void {
    const item = { label: '', url: '', thumbnail_url: '' };
    if (platform === 'instagram') this.socialForm.instagram_pages = [...this.socialForm.instagram_pages, item];
    else this.socialForm.facebook_pages = [...this.socialForm.facebook_pages, item];
  }

  removeSocialLink(platform: 'instagram' | 'facebook', index: number): void {
    if (platform === 'instagram') {
      this.socialForm.instagram_pages = this.socialForm.instagram_pages.filter((_, i) => i !== index);
      return;
    }
    this.socialForm.facebook_pages = this.socialForm.facebook_pages.filter((_, i) => i !== index);
  }

  socialThumbKey(platform: 'instagram' | 'facebook', index: number): string {
    return `${platform}-${index}`;
  }

	  fetchSocialThumbnail(platform: 'instagram' | 'facebook', index: number): void {
	    const key = this.socialThumbKey(platform, index);
	    const pages = platform === 'instagram' ? this.socialForm.instagram_pages : this.socialForm.facebook_pages;
	    const page = pages[index];
	    const url = String(page?.url || '').trim();
	    if (!url) {
	      this.socialThumbErrors[key] = this.t('adminUi.site.social.errors.urlRequired');
	      return;
	    }

    this.socialThumbErrors[key] = '';
    this.socialThumbLoading[key] = true;

	    this.admin.fetchSocialThumbnail(url).subscribe({
	      next: (res) => {
	        this.socialThumbLoading[key] = false;
	        const thumb = String(res?.thumbnail_url || '').trim();
	        if (!thumb) {
	          this.socialThumbErrors[key] = this.t('adminUi.site.social.errors.noThumbnail');
	          return;
	        }
	        page.thumbnail_url = thumb;
	        this.toast.success(
	          this.t('adminUi.site.social.success.thumbnailUpdated'),
	          (page.label || '').trim() || (page.url || '').trim() || this.t('adminUi.site.social.socialLink')
	        );
	      },
	      error: (err) => {
	        this.socialThumbLoading[key] = false;
	        const msg = err?.error?.detail
	          ? String(err.error.detail)
	          : this.t('adminUi.site.social.errors.fetchFailed');
	        this.socialThumbErrors[key] = msg;
	      }
	    });
	  }

	  saveSocial(): void {
	    this.socialMessage = null;
	    this.socialError = null;
	    const instagram_pages = this.sanitizeSocialPages(this.socialForm.instagram_pages);
	    const facebook_pages = this.sanitizeSocialPages(this.socialForm.facebook_pages);
    const payload = {
      title: 'Site social links',
      body_markdown: 'Social pages and contact details used across the storefront.',
      status: 'published',
      meta: {
        version: 1,
        contact: { phone: (this.socialForm.phone || '').trim(), email: (this.socialForm.email || '').trim() },
        instagram_pages,
        facebook_pages
      }
	    };
	    const onSuccess = (block?: { version?: number } | null) => {
        this.rememberContentVersion('site.social', block);
	      this.socialMessage = this.t('adminUi.site.social.success.save');
	      this.socialError = null;
	    };
	    this.admin.updateContentBlock('site.social', this.withExpectedVersion('site.social', payload)).subscribe({
	      next: (block) => onSuccess(block),
	      error: (err) => {
          if (this.handleContentConflict(err, 'site.social', () => this.loadSocial())) {
            this.socialError = this.t('adminUi.site.social.errors.save');
            this.socialMessage = null;
            return;
          }
	        this.admin.createContent('site.social', payload).subscribe({
	          next: (created) => onSuccess(created),
	          error: () => {
	            this.socialError = this.t('adminUi.site.social.errors.save');
	            this.socialMessage = null;
	          }
	        })
        }
	    });
	  }

  private newNavigationId(prefix: string): string {
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
  }

  private defaultNavigationForm(): {
    header_links: Array<{ id: string; url: string; label: LocalizedText }>;
    footer_handcrafted_links: Array<{ id: string; url: string; label: LocalizedText }>;
    footer_legal_links: Array<{ id: string; url: string; label: LocalizedText }>;
  } {
    return {
      header_links: [
        { id: this.newNavigationId('nav'), url: '/', label: { en: 'Home', ro: 'Acasă' } },
        { id: this.newNavigationId('nav'), url: '/blog', label: { en: 'Blog', ro: 'Blog' } },
        { id: this.newNavigationId('nav'), url: '/shop', label: { en: 'Shop', ro: 'Magazin' } },
        { id: this.newNavigationId('nav'), url: '/about', label: { en: 'Our story', ro: 'Povestea noastră' } },
        { id: this.newNavigationId('nav'), url: '/contact', label: { en: 'Contact', ro: 'Contact' } },
        { id: this.newNavigationId('nav'), url: '/pages/terms', label: { en: 'Terms & Conditions', ro: 'Termeni și condiții' } }
      ],
      footer_handcrafted_links: [
        { id: this.newNavigationId('nav'), url: '/shop', label: { en: 'Shop', ro: 'Magazin' } },
        { id: this.newNavigationId('nav'), url: '/about', label: { en: 'Our story', ro: 'Povestea noastră' } },
        { id: this.newNavigationId('nav'), url: '/contact', label: { en: 'Contact', ro: 'Contact' } },
        { id: this.newNavigationId('nav'), url: '/pages/terms', label: { en: 'Terms & Conditions', ro: 'Termeni și condiții' } }
      ],
      footer_legal_links: [
        { id: this.newNavigationId('nav'), url: '/pages/terms', label: { en: 'Terms & Conditions', ro: 'Termeni și condiții' } },
        { id: this.newNavigationId('nav'), url: '/pages/privacy-policy', label: { en: 'Privacy Policy', ro: 'Politica de confidențialitate' } },
        { id: this.newNavigationId('nav'), url: '/pages/anpc', label: { en: 'ANPC', ro: 'ANPC' } }
      ]
    };
  }

  private parseNavigationLinks(value: unknown): Array<{ id: string; url: string; label: LocalizedText }> {
    if (!Array.isArray(value)) return [];
    const out: Array<{ id: string; url: string; label: LocalizedText }> = [];
    const seen = new Set<string>();
    for (const [idx, raw] of value.entries()) {
      if (!raw || typeof raw !== 'object') continue;
      const rec = raw as Record<string, unknown>;
      const idRaw = typeof rec['id'] === 'string' ? rec['id'].trim() : '';
      const url = typeof rec['url'] === 'string' ? rec['url'].trim() : '';
      const labelRaw = rec['label'];
      const labelRec = labelRaw && typeof labelRaw === 'object' ? (labelRaw as Record<string, unknown>) : {};
      const en = typeof labelRec['en'] === 'string' ? labelRec['en'].trim() : '';
      const ro = typeof labelRec['ro'] === 'string' ? labelRec['ro'].trim() : '';
      if (!url || !en || !ro) continue;
      const id = idRaw || `nav_${idx + 1}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, url, label: { en, ro } });
    }
    return out;
  }

  loadNavigation(): void {
    this.navigationError = null;
    this.navigationMessage = null;
    this.admin.getContent('site.navigation').subscribe({
      next: (block) => {
        this.rememberContentVersion('site.navigation', block);
        const meta = (block.meta || {}) as Record<string, any>;
        const header_links = this.parseNavigationLinks(meta['header_links']);
        const footer_handcrafted_links = this.parseNavigationLinks(meta['footer_handcrafted_links']);
        const footer_legal_links = this.parseNavigationLinks(meta['footer_legal_links']);
        this.navigationForm = {
          header_links,
          footer_handcrafted_links,
          footer_legal_links
        };
      },
      error: () => {
        delete this.contentVersions['site.navigation'];
        this.navigationForm = this.defaultNavigationForm();
      }
    });
  }

  addNavigationLink(list: 'header' | 'footer_handcrafted' | 'footer_legal'): void {
    const item = { id: this.newNavigationId('nav'), url: '', label: this.emptyLocalizedText() };
    if (list === 'header') {
      this.navigationForm.header_links = [...this.navigationForm.header_links, item];
      return;
    }
    if (list === 'footer_handcrafted') {
      this.navigationForm.footer_handcrafted_links = [...this.navigationForm.footer_handcrafted_links, item];
      return;
    }
    this.navigationForm.footer_legal_links = [...this.navigationForm.footer_legal_links, item];
  }

  removeNavigationLink(list: 'header' | 'footer_handcrafted' | 'footer_legal', id: string): void {
    const key = (id || '').trim();
    if (!key) return;
    if (list === 'header') {
      this.navigationForm.header_links = this.navigationForm.header_links.filter((l) => l.id !== key);
      return;
    }
    if (list === 'footer_handcrafted') {
      this.navigationForm.footer_handcrafted_links = this.navigationForm.footer_handcrafted_links.filter((l) => l.id !== key);
      return;
    }
    this.navigationForm.footer_legal_links = this.navigationForm.footer_legal_links.filter((l) => l.id !== key);
  }

  moveNavigationLink(list: 'header' | 'footer_handcrafted' | 'footer_legal', id: string, delta: number): void {
    const key = (id || '').trim();
    if (!key) return;
    const items =
      list === 'header'
        ? [...this.navigationForm.header_links]
        : list === 'footer_handcrafted'
          ? [...this.navigationForm.footer_handcrafted_links]
          : [...this.navigationForm.footer_legal_links];

    const fromIdx = items.findIndex((l) => l.id === key);
    const toIdx = fromIdx + delta;
    if (fromIdx < 0 || toIdx < 0 || toIdx >= items.length) return;
    const [moved] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, moved);

    if (list === 'header') this.navigationForm.header_links = items;
    else if (list === 'footer_handcrafted') this.navigationForm.footer_handcrafted_links = items;
    else this.navigationForm.footer_legal_links = items;
  }

  resetNavigationDefaults(): void {
    if (!window.confirm(this.t('adminUi.site.navigation.confirms.resetDefaults'))) return;
    this.navigationForm = this.defaultNavigationForm();
    this.navigationError = null;
    this.navigationMessage = null;
  }

  onNavigationDragStart(list: 'header' | 'footer_handcrafted' | 'footer_legal', id: string): void {
    this.draggingNavList = list;
    this.draggingNavId = (id || '').trim();
  }

  onNavigationDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onNavigationDrop(list: 'header' | 'footer_handcrafted' | 'footer_legal', targetId: string): void {
    const draggingList = this.draggingNavList;
    const draggingId = (this.draggingNavId || '').trim();
    const target = (targetId || '').trim();
    if (!draggingList || !draggingId || draggingList !== list || draggingId === target) {
      this.draggingNavList = null;
      this.draggingNavId = null;
      return;
    }
    const items =
      list === 'header'
        ? [...this.navigationForm.header_links]
        : list === 'footer_handcrafted'
          ? [...this.navigationForm.footer_handcrafted_links]
          : [...this.navigationForm.footer_legal_links];
    const fromIdx = items.findIndex((l) => l.id === draggingId);
    const toIdx = items.findIndex((l) => l.id === target);
    if (fromIdx < 0 || toIdx < 0) {
      this.draggingNavList = null;
      this.draggingNavId = null;
      return;
    }
    const [moved] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, moved);

    if (list === 'header') this.navigationForm.header_links = items;
    else if (list === 'footer_handcrafted') this.navigationForm.footer_handcrafted_links = items;
    else this.navigationForm.footer_legal_links = items;

    this.draggingNavList = null;
    this.draggingNavId = null;
  }

  saveNavigation(): void {
    this.navigationMessage = null;
    this.navigationError = null;

    const cleanList = (items: Array<{ id: string; url: string; label: LocalizedText }>) => {
      const out: Array<{ id: string; url: string; label: LocalizedText }> = [];
      let invalid = false;
      const seen = new Set<string>();
      for (const item of items) {
        const id = (item?.id || '').trim() || this.newNavigationId('nav');
        const url = (item?.url || '').trim();
        const en = (item?.label?.en || '').trim();
        const ro = (item?.label?.ro || '').trim();
        const isBlank = !url && !en && !ro;
        if (isBlank) continue;
        if (!url || !en || !ro) {
          invalid = true;
          continue;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ id, url, label: { en, ro } });
      }
      return { out, invalid };
    };

    const header = cleanList(this.navigationForm.header_links);
    const handcrafted = cleanList(this.navigationForm.footer_handcrafted_links);
    const legal = cleanList(this.navigationForm.footer_legal_links);

    if (header.invalid || handcrafted.invalid || legal.invalid) {
      this.navigationError = this.t('adminUi.site.navigation.errors.invalid');
      return;
    }

    const payload = {
      title: 'Site navigation',
      body_markdown: 'Header and footer navigation menus.',
      status: 'published',
      meta: {
        version: 1,
        header_links: header.out,
        footer_handcrafted_links: handcrafted.out,
        footer_legal_links: legal.out
      }
    };

    const onSuccess = (block?: { version?: number } | null) => {
      this.rememberContentVersion('site.navigation', block);
      this.navigationMessage = this.t('adminUi.site.navigation.success.save');
      this.navigationError = null;
    };

    this.admin.updateContentBlock('site.navigation', this.withExpectedVersion('site.navigation', payload)).subscribe({
      next: (block) => onSuccess(block),
      error: (err) => {
        if (this.handleContentConflict(err, 'site.navigation', () => this.loadNavigation())) {
          this.navigationError = this.t('adminUi.site.navigation.errors.save');
          this.navigationMessage = null;
          return;
        }
        this.admin.createContent('site.navigation', payload).subscribe({
          next: (created) => onSuccess(created),
          error: () => {
            this.navigationError = this.t('adminUi.site.navigation.errors.save');
            this.navigationMessage = null;
          }
        });
      }
    });
  }

  private parseSocialPages(
    raw: unknown,
    fallback: Array<{ label: string; url: string; thumbnail_url: string }>
  ): Array<{ label: string; url: string; thumbnail_url: string }> {
    if (!Array.isArray(raw)) return fallback;
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const label = String((item).label ?? '').trim();
        const url = String((item).url ?? '').trim();
        const thumb = String((item).thumbnail_url ?? '').trim();
        return { label, url, thumbnail_url: thumb };
      })
      .filter((x): x is { label: string; url: string; thumbnail_url: string } => !!x);
  }

  private sanitizeSocialPages(
    pages: Array<{ label: string; url: string; thumbnail_url: string }>
  ): Array<{ label: string; url: string; thumbnail_url?: string | null }> {
    const out: Array<{ label: string; url: string; thumbnail_url?: string | null }> = [];
    for (const page of pages) {
      const label = String(page.label || '').trim();
      const url = String(page.url || '').trim();
      const thumb = String(page.thumbnail_url || '').trim();
      if (!label || !url) continue;
      out.push({ label, url, thumbnail_url: thumb || null });
    }
    return out;
  }

  selectSeoLang(lang: 'en' | 'ro'): void {
    this.seoLang = lang;
    this.loadSeo();
  }

  loadSeo(): void {
    this.seoMessage = null;
    this.seoError = null;
    this.admin.getContent(`seo.${this.seoPage}`, this.seoLang).subscribe({
      next: (block) => {
        this.rememberContentVersion(`seo.${this.seoPage}`, block);
        this.seoForm = {
          title: block.title || '',
          description: block.meta?.['description'] || ''
        };
        this.seoMessage = null;
      },
      error: () => {
        delete this.contentVersions[`seo.${this.seoPage}`];
        this.seoForm = { title: '', description: '' };
      }
    });
  }

	  saveSeo(): void {
    const payload = {
      title: this.seoForm.title,
      status: 'published',
      lang: this.seoLang,
      meta: { description: this.seoForm.description }
    };
	    const key = `seo.${this.seoPage}`;
	    const onSuccess = () => {
	      this.seoMessage = this.t('adminUi.site.seo.success.save');
	      this.seoError = null;
	    };
	    this.admin.updateContentBlock(key, this.withExpectedVersion(key, payload)).subscribe({
	      next: (block) => {
          this.rememberContentVersion(key, block);
          onSuccess();
        },
	      error: (err) => {
          if (this.handleContentConflict(err, key, () => this.loadSeo())) {
            this.seoError = this.t('adminUi.site.seo.errors.save');
            this.seoMessage = null;
            return;
          }
	        this.admin.createContent(key, payload).subscribe({
	          next: (created) => {
              this.rememberContentVersion(key, created);
              onSuccess();
            },
	          error: () => {
	            this.seoError = this.t('adminUi.site.seo.errors.save');
	            this.seoMessage = null;
	          }
	        })
        }
		    });
		  }

  loadSitemapPreview(): void {
    this.sitemapPreviewLoading = true;
    this.sitemapPreviewError = null;
    this.sitemapPreviewByLang = null;
    this.admin.getSitemapPreview().subscribe({
      next: (res) => {
        this.sitemapPreviewByLang = (res && typeof res === 'object' ? res.by_lang : null) || {};
        this.sitemapPreviewLoading = false;
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.sitemapPreviewLoading = false;
        this.sitemapPreviewByLang = null;
        this.sitemapPreviewError = detail || this.t('adminUi.site.seo.sitemapPreview.errors.load');
      }
    });
  }

  structuredDataIssueUrl(issue: { entity_type: string; entity_key: string }): string {
    const type = String(issue?.entity_type || '').trim().toLowerCase();
    const key = String(issue?.entity_key || '').trim();
    if (type === 'product') {
      return `/products/${encodeURIComponent(key)}`;
    }
    if (type === 'page') {
      const raw = key.startsWith('page.') ? key.slice('page.'.length) : key;
      if (raw === 'about') return '/about';
      if (raw === 'contact') return '/contact';
      if (!raw) return '/pages';
      return `/pages/${encodeURIComponent(raw)}`;
    }
    return '/';
  }

  runStructuredDataValidation(): void {
    this.structuredDataLoading = true;
    this.structuredDataError = null;
    this.structuredDataResult = null;
    this.admin.validateStructuredData().subscribe({
      next: (res) => {
        this.structuredDataLoading = false;
        this.structuredDataResult = res || null;
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.structuredDataLoading = false;
        this.structuredDataResult = null;
        this.structuredDataError = detail || this.t('adminUi.site.seo.structuredData.errors.load');
      }
    });
  }

	  selectInfoLang(lang: UiLang): void {
	    this.infoLang = lang;
	  }

  loadInfo(): void {
    const loadKey = async (key: string, target: 'about' | 'faq' | 'shipping' | 'contact'): Promise<void> => {
      const next: LocalizedText = { ...this.infoForm[target] };

      try {
        const enBlock = await firstValueFrom(this.admin.getContent(key, 'en'));
        this.rememberContentVersion(key, enBlock);
        next.en = enBlock.body_markdown || '';
        this.infoForm[target] = { ...this.infoForm[target], en: next.en };
      } catch {
        delete this.contentVersions[key];
      }

      try {
        const roBlock = await firstValueFrom(this.admin.getContent(key, 'ro'));
        next.ro = roBlock.body_markdown || '';
        this.infoForm[target] = { ...this.infoForm[target], ro: next.ro };
      } catch {
        // ignore
      }

    };

    void loadKey('page.about', 'about');
    void loadKey('page.faq', 'faq');
    void loadKey('page.shipping', 'shipping');
    void loadKey('page.contact', 'contact');
  }

  saveInfoUi(key: 'page.about' | 'page.faq' | 'page.shipping' | 'page.contact', body: LocalizedText): void {
    if (this.cmsPrefs.translationLayout() === 'sideBySide') {
      this.saveInfoBoth(key, body);
      return;
    }
    this.saveInfo(key, body[this.infoLang] || '', this.infoLang);
  }

  private saveInfoInternal(
    key: 'page.about' | 'page.faq' | 'page.shipping' | 'page.contact',
    body: string,
    lang: UiLang,
    onSuccess: () => void,
    onError: () => void
  ): void {
    const payload = {
      body_markdown: body,
      status: 'published',
      lang
    };
    const createPayload = {
      title: key,
      ...payload
    };

    const onSuccessWithBlock = (block?: any | null) => {
      this.rememberContentVersion(key, block);
      const safePageKey = this.safePageRecordKey(key as PageBuilderKey);
      this.setPageRecordValue(this.pageBlocksNeedsTranslationEn, safePageKey, Boolean(block?.needs_translation_en));
      this.setPageRecordValue(this.pageBlocksNeedsTranslationRo, safePageKey, Boolean(block?.needs_translation_ro));
      this.loadContentPages();
      onSuccess();
    };

    this.admin.updateContentBlock(key, this.withExpectedVersion(key, payload)).subscribe({
      next: (block) => onSuccessWithBlock(block),
      error: (err) => {
        if (this.handleContentConflict(err, key, () => this.loadInfo())) {
          onError();
          return;
        }
        this.admin.createContent(key, createPayload).subscribe({
          next: (created) => onSuccessWithBlock(created),
          error: () => onError()
        });
      }
    });
  }

  pagePublicUrlForKey(key: string): string {
    const raw = String(key || '');
    const slug = raw.startsWith('page.') ? raw.slice('page.'.length) : raw;
    if (slug === 'about') return '/about';
    if (slug === 'contact') return '/contact';
    if (!slug) return '/pages';
    return `/pages/${encodeURIComponent(slug)}`;
  }

  private readonly protectedHiddenPageKeys = new Set<string>([
    'page.about',
    'page.contact',
    'page.terms',
    'page.terms-and-conditions',
    'page.privacy-policy',
    'page.anpc',
  ]);

  isPageHidden(key: PageBuilderKey): boolean {
    const raw = String(key || '').trim();
    if (!raw || isCmsGlobalSectionKey(raw)) return false;
    return Boolean(this.contentPages.find((p) => p.key === raw)?.hidden);
  }

  canTogglePageHidden(key: PageBuilderKey): boolean {
    const raw = String(key || '').trim();
    if (!raw || isCmsGlobalSectionKey(raw)) return false;
    if (!raw.startsWith('page.')) return false;
    return !this.protectedHiddenPageKeys.has(raw);
  }

  togglePageHidden(key: PageBuilderKey): void {
    const raw = String(key || '').trim();
    if (!raw || !this.canTogglePageHidden(key)) return;
    const target = !this.isPageHidden(key);
    this.setPageHidden(raw, target);
  }

  private setPageHidden(key: string, hidden: boolean): void {
    const target = this.safePageRecordKey((key || '').trim() as PageBuilderKey);
    if (!target) return;

    const pageIndex = this.contentPages.findIndex((p) => p.key === target);
    const prevHidden = pageIndex >= 0 ? Boolean(this.contentPages[pageIndex]?.hidden) : null;
    if (pageIndex >= 0) {
      this.contentPages[pageIndex] = { ...this.contentPages[pageIndex], hidden };
      this.contentPages = [...this.contentPages];
      if (!this.showHiddenPages && hidden) this.ensureSelectedPageIsVisible();
    }

    this.setRecordValue(this.pageVisibilitySaving, target, true);
    this.admin.getContent(target).subscribe({
      next: (block) => {
        this.rememberContentVersion(target, block);
        const currentMeta = this.toRecord(block?.meta);
        const nextMeta: Record<string, unknown> = { ...currentMeta, hidden };
        const payload = this.withExpectedVersion(target, { meta: nextMeta });
        this.admin.updateContentBlock(target, payload).subscribe({
          next: (updated) => {
            this.rememberContentVersion(target, updated);
            this.setRecordValue(this.pageVisibilitySaving, target, false);
            this.toast.success(hidden ? this.t('adminUi.site.pages.visibility.hidden') : this.t('adminUi.site.pages.visibility.visible'));
            this.loadContentPages();
            if (!this.showHiddenPages) this.ensureSelectedPageIsVisible();
          },
          error: (err) => {
            this.setRecordValue(this.pageVisibilitySaving, target, false);
            if (prevHidden !== null && pageIndex >= 0) {
              this.contentPages[pageIndex] = { ...this.contentPages[pageIndex], hidden: prevHidden };
              this.contentPages = [...this.contentPages];
            }
            if (this.handleContentConflict(err, target, () => this.loadContentPages())) return;
            this.toast.error(this.t('adminUi.site.pages.visibility.errors.save'));
          }
        });
      },
      error: () => {
        this.setRecordValue(this.pageVisibilitySaving, target, false);
        if (prevHidden !== null && pageIndex >= 0) {
          this.contentPages[pageIndex] = { ...this.contentPages[pageIndex], hidden: prevHidden };
          this.contentPages = [...this.contentPages];
        }
        this.toast.error(this.t('adminUi.site.pages.visibility.errors.load'));
      }
    });
  }

  onLegalPageKeyChange(next: LegalPageKey): void {
    if (!next || next === this.legalPageKey) return;
    this.legalPageKey = next;
    this.loadLegalPage(next);
  }

  loadLegalPage(key: LegalPageKey): void {
    this.legalPageLoading = true;
    this.legalPageMessage = null;
    this.legalPageError = null;
    const target = (key || '').trim();
    if (!target) {
      this.legalPageLoading = false;
      this.legalPageError = 'Missing page key.';
      return;
    }

    forkJoin([
      this.admin.getContent(target, 'en').pipe(catchError((err) => (err?.status === 404 ? of(null) : of(err)))),
      this.admin.getContent(target, 'ro').pipe(catchError((err) => (err?.status === 404 ? of(null) : of(err))))
    ]).subscribe({
      next: ([enRes, roRes]) => {
        const enBlock = (enRes && typeof enRes === 'object' && 'body_markdown' in enRes) ? (enRes) : null;
        const roBlock = (roRes && typeof roRes === 'object' && 'body_markdown' in roRes) ? (roRes) : null;

        if (!enBlock && enRes?.status && enRes.status !== 404) {
          this.legalPageError = this.t('adminUi.site.pages.errors.load');
        }

        if (enBlock) this.rememberContentVersion(target, enBlock);
        if (!enBlock && roBlock) this.rememberContentVersion(target, roBlock);

        this.legalPageForm = {
          en: enBlock?.body_markdown || '',
          ro: roBlock?.body_markdown || ''
        };
        const meta = this.toRecord(enBlock?.meta ?? roBlock?.meta);
        this.legalPageMeta = { ...meta };
        const lastUpdated = typeof this.legalPageMeta['last_updated'] === 'string' ? String(this.legalPageMeta['last_updated']) : '';
        this.legalPageLastUpdated = lastUpdated;
        this.legalPageLastUpdatedOriginal = lastUpdated;

        this.legalPageLoading = false;
      },
      error: () => {
        this.legalPageLoading = false;
        this.legalPageError = this.t('adminUi.site.pages.errors.load');
      }
    });
  }

  private saveLegalMetaIfNeeded(key: LegalPageKey, onSuccess: () => void, onError: () => void): void {
    const next = String(this.legalPageLastUpdated || '').trim();
    const prev = String(this.legalPageLastUpdatedOriginal || '').trim();
    if (next === prev) {
      onSuccess();
      return;
    }
    const meta: Record<string, unknown> = { ...(this.legalPageMeta || {}) };
    if (next) meta['last_updated'] = next;
    else delete meta['last_updated'];

    this.admin.updateContentBlock(key, this.withExpectedVersion(key, { meta })).subscribe({
      next: (updated) => {
        this.rememberContentVersion(key, updated);
        const updatedMeta = this.toRecord(updated?.meta);
        this.legalPageMeta = { ...updatedMeta };
        const lastUpdated = typeof this.legalPageMeta['last_updated'] === 'string' ? String(this.legalPageMeta['last_updated']) : '';
        this.legalPageLastUpdated = lastUpdated;
        this.legalPageLastUpdatedOriginal = lastUpdated;
        onSuccess();
      },
      error: (err) => {
        if (this.handleContentConflict(err, key, () => this.loadLegalPage(key))) {
          onError();
          return;
        }
        onError();
      }
    });
  }

  saveLegalPageUi(): void {
    const key = this.legalPageKey;
    if (!key) return;
    if (this.cmsPrefs.translationLayout() === 'sideBySide') {
      this.saveLegalPageBoth(key, this.legalPageForm);
      return;
    }
    this.saveLegalPage(key, this.legalPageForm[this.infoLang] || '', this.infoLang);
  }

  private saveLegalPage(key: LegalPageKey, body: string, lang: UiLang): void {
    this.legalPageMessage = null;
    this.legalPageError = null;
    this.legalPageSaving = true;
    this.saveLegalMetaIfNeeded(
      key,
      () => {
        this.savePageMarkdownInternal(
          key,
          body,
          lang,
          () => {
            this.legalPageSaving = false;
            this.legalPageMessage = this.t('adminUi.site.pages.success.save');
          },
          () => {
            this.legalPageSaving = false;
            this.legalPageError = this.t('adminUi.site.pages.errors.save');
          }
        );
      },
      () => {
        this.legalPageSaving = false;
        this.legalPageError = this.t('adminUi.site.pages.errors.save');
      }
    );
  }

  private saveLegalPageBoth(key: LegalPageKey, body: LocalizedText): void {
    this.legalPageMessage = null;
    this.legalPageError = null;
    this.legalPageSaving = true;
    this.saveLegalMetaIfNeeded(
      key,
      () => {
        this.savePageMarkdownInternal(
          key,
          body.en || '',
          'en',
          () => {
            this.savePageMarkdownInternal(
              key,
              body.ro || '',
              'ro',
              () => {
                this.legalPageSaving = false;
                this.legalPageMessage = this.t('adminUi.site.pages.success.save');
              },
              () => {
                this.legalPageSaving = false;
                this.legalPageError = this.t('adminUi.site.pages.errors.save');
              }
            );
          },
          () => {
            this.legalPageSaving = false;
            this.legalPageError = this.t('adminUi.site.pages.errors.save');
          }
        );
      },
      () => {
        this.legalPageSaving = false;
        this.legalPageError = this.t('adminUi.site.pages.errors.save');
      }
    );
  }

  private savePageMarkdownInternal(
    key: string,
    body: string,
    lang: UiLang,
    onSuccess: () => void,
    onError: () => void
  ): void {
    const payload = { body_markdown: body, status: 'published', lang };
    const createPayload = { title: key, ...payload };

    const onSuccessWithBlock = (block?: any | null) => {
      this.rememberContentVersion(key, block);
      const safePageKey = this.safePageRecordKey(key as PageBuilderKey);
      this.setPageRecordValue(this.pageBlocksNeedsTranslationEn, safePageKey, Boolean(block?.needs_translation_en));
      this.setPageRecordValue(this.pageBlocksNeedsTranslationRo, safePageKey, Boolean(block?.needs_translation_ro));
      this.loadContentPages();
      onSuccess();
    };

    this.admin.updateContentBlock(key, this.withExpectedVersion(key, payload)).subscribe({
      next: (block) => onSuccessWithBlock(block),
      error: (err) => {
        if (this.handleContentConflict(err, key, () => this.loadLegalPage(key as LegalPageKey))) {
          onError();
          return;
        }
        this.admin.createContent(key, createPayload).subscribe({
          next: (created) => onSuccessWithBlock(created),
          error: () => onError()
        });
      }
    });
  }

  saveInfo(key: 'page.about' | 'page.faq' | 'page.shipping' | 'page.contact', body: string, lang: UiLang = this.infoLang): void {
    this.infoMessage = null;
    this.infoError = null;
    this.saveInfoInternal(
      key,
      body,
      lang,
      () => {
        this.infoMessage = this.t('adminUi.site.pages.success.save');
        this.infoError = null;
      },
      () => {
        this.infoError = this.t('adminUi.site.pages.errors.save');
        this.infoMessage = null;
      }
    );
  }

  saveInfoBoth(key: 'page.about' | 'page.faq' | 'page.shipping' | 'page.contact', body: LocalizedText): void {
    this.infoMessage = null;
    this.infoError = null;
    this.saveInfoInternal(
      key,
      body.en || '',
      'en',
      () => {
        this.saveInfoInternal(
          key,
          body.ro || '',
          'ro',
          () => {
            this.infoMessage = this.t('adminUi.site.pages.success.save');
            this.infoError = null;
          },
          () => {
            this.infoError = this.t('adminUi.site.pages.errors.save');
            this.infoMessage = null;
          }
        );
      },
      () => {
        this.infoError = this.t('adminUi.site.pages.errors.save');
        this.infoMessage = null;
      }
    );
  }

  togglePageNeedsTranslation(pageKey: PageBuilderKey, lang: UiLang, event: Event): void {
    const key = this.safePageRecordKey(pageKey);
    if (!key) return;
    const target = event.target as HTMLInputElement | null;
    const checked = Boolean(target?.checked);
    const payload = lang === 'en' ? { needs_translation_en: checked } : { needs_translation_ro: checked };
    this.setPageRecordValue(this.pageBlocksTranslationSaving, key, true);
    this.admin.updateContentTranslationStatus(key, payload).subscribe({
      next: (block) => {
        this.setPageRecordValue(this.pageBlocksNeedsTranslationEn, key, Boolean(block.needs_translation_en));
        this.setPageRecordValue(this.pageBlocksNeedsTranslationRo, key, Boolean(block.needs_translation_ro));
        this.setPageRecordValue(this.pageBlocksTranslationSaving, key, false);
        this.toast.success(this.t('adminUi.site.pages.builder.translation.success'));
        this.loadContentPages();
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.setPageRecordValue(this.pageBlocksTranslationSaving, key, false);
        this.toast.error(detail || this.t('adminUi.site.pages.builder.translation.errors.save'));
      }
    });
  }

  loadContentPages(): void {
    this.contentPagesLoading = true;
    this.contentPagesError = null;
    this.admin.listContentPages().subscribe({
      next: (pages) => {
        this.contentPages = [...(pages || [])].sort((a, b) => (a.slug || '').localeCompare(b.slug || ''));
        this.pageBlocksNeedsTranslationEn = {};
        this.pageBlocksNeedsTranslationRo = {};
        for (const page of this.contentPages) {
          this.pageBlocksNeedsTranslationEn[page.key] = Boolean(page.needs_translation_en);
          this.pageBlocksNeedsTranslationRo[page.key] = Boolean(page.needs_translation_ro);
        }
        this.contentPagesLoading = false;
        this.ensureSelectedPageIsVisible();
	      },
      error: () => {
        this.contentPagesLoading = false;
        this.contentPages = [];
        this.contentPagesError = this.t('adminUi.site.pages.errors.load');
      }
    });
  }

  visibleContentPages(): ContentPageListItem[] {
    const base = [...(this.contentPages || [])];
    return this.showHiddenPages ? base : base.filter((p) => !p.hidden);
  }

  onShowHiddenPagesChange(): void {
    this.ensureSelectedPageIsVisible();
  }

  private ensureSelectedPageIsVisible(): void {
    const pages = this.visibleContentPages();
    if (!pages.length) return;
    if (isCmsGlobalSectionKey(this.pageBlocksKey)) return;
    const exists = pages.some((p) => p.key === this.pageBlocksKey);
    if (exists) return;
    const preferred = pages.find((p) => p.key === 'page.about')?.key || pages[0].key;
    const prev = this.pageBlocksKey;
    this.pageBlocksKey = preferred as PageBuilderKey;
    this.ensureNewPageBlockTypeForKey(this.pageBlocksKey);
    if (prev !== this.pageBlocksKey) {
      this.loadPageBlocks(this.pageBlocksKey);
    }
  }

  loadReusableBlocks(): void {
    this.reusableBlocksLoading = true;
    this.reusableBlocksError = null;
    this.admin.getContent(this.reusableBlocksKey).subscribe({
      next: (block) => {
        this.rememberContentVersion(this.reusableBlocksKey, block);
        this.reusableBlocksMeta = this.toRecord(block?.meta);
        this.reusableBlocks = this.parseReusableBlocks(this.reusableBlocksMeta);
        this.reusableBlocksExists = true;
        this.reusableBlocksLoading = false;
      },
      error: (err) => {
        this.reusableBlocksLoading = false;
        if (err?.status === 404) {
          this.deleteRecordValue(this.contentVersions, this.reusableBlocksKey);
          this.reusableBlocksMeta = {};
          this.reusableBlocks = [];
          this.reusableBlocksExists = false;
          return;
        }
        this.reusableBlocksMeta = {};
        this.reusableBlocks = [];
        this.reusableBlocksExists = false;
        this.reusableBlocksError = this.t('adminUi.content.reusableBlocks.errors.load');
      }
    });
  }

  filteredReusableBlocks(): CmsReusableBlock[] {
    const query = (this.reusableBlocksQuery || '').trim().toLowerCase();
    const base = [...(this.reusableBlocks || [])];
    base.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    if (!query) return base;
    return base.filter((b) => (b.title || '').toLowerCase().includes(query) || (b.id || '').toLowerCase().includes(query));
  }

  savePageBlockAsReusable(pageKey: PageBuilderKey, blockKey: string): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    const blocks = this.pageBlocks[safePageKey] || [];
    const target = blocks.find((b) => b.key === blockKey);
    if (!target) return;

    const defaultTitle = (target.title?.[this.infoLang] || target.title?.en || target.title?.ro || '').trim() || this.pageBlockLabel(target);
    const title = (window.prompt(this.t('adminUi.content.reusableBlocks.prompts.name'), defaultTitle) || '').trim();
    if (!title) return;

    const idBase = this.slugifyReusableBlockId(title);
    if (!idBase) return;
    const existing = this.reusableBlocks.find((b) => b.id === idBase);
    if (existing) {
      const ok = window.confirm(this.t('adminUi.content.reusableBlocks.prompts.overwriteConfirm', { title: existing.title }));
      if (!ok) return;
    }

    const { key: blockDraftKey, ...rest } = target;
    void blockDraftKey;
    const snapshot = this.deepCloneJson(rest) as Omit<PageBlockDraft, 'key'>;
    snapshot.enabled = true;
    snapshot.layout = this.toCmsBlockLayout(snapshot.layout);

    const next: CmsReusableBlock = { id: idBase, title, block: snapshot };
    const updated = existing ? this.reusableBlocks.map((b) => (b.id === idBase ? next : b)) : [...this.reusableBlocks, next];
    this.persistReusableBlocks(updated, { successKey: 'adminUi.content.reusableBlocks.success.saved' });
  }

  insertReusableBlockIntoPage(pageKey: PageBuilderKey, id: string): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    const found = this.reusableBlocks.find((b) => b.id === id);
    if (!found) return;
    const current = [...(this.pageBlocks[safePageKey] || [])];
    const existingKeys = new Set(current.map((b) => b.key));
    const type = found.block.type;
    const base = `${type}_${id}_${Date.now()}`;
    let nextKey = base;
    let suffix = 1;
    while (existingKeys.has(nextKey)) {
      nextKey = `${base}_${suffix++}`;
    }

    const snapshot = this.deepCloneJson(found.block) as Omit<PageBlockDraft, 'key'>;
    const draft = { ...snapshot, key: nextKey, enabled: true, layout: this.toCmsBlockLayout(snapshot.layout) } satisfies PageBlockDraft;
    current.push(draft);
    this.pageBlocks[safePageKey] = current;
  }

  deleteReusableBlock(id: string): void {
    const found = this.reusableBlocks.find((b) => b.id === id);
    if (!found) return;
    const ok = window.confirm(this.t('adminUi.content.reusableBlocks.prompts.deleteConfirm', { title: found.title }));
    if (!ok) return;
    const updated = this.reusableBlocks.filter((b) => b.id !== id);
    this.persistReusableBlocks(updated, { successKey: 'adminUi.content.reusableBlocks.success.deleted' });
  }

  private persistReusableBlocks(next: CmsReusableBlock[], opts?: { successKey?: string }): void {
    const meta = { ...(this.reusableBlocksMeta || {}), snippets: next } as Record<string, unknown>;
    const payload = this.withExpectedVersion(this.reusableBlocksKey, { meta });

    const onSaved = (block: { version?: number; meta?: Record<string, unknown> | null } | null | undefined) => {
      this.rememberContentVersion(this.reusableBlocksKey, block);
      this.reusableBlocksMeta = this.toRecord(block?.meta);
      this.reusableBlocks = this.parseReusableBlocks(this.reusableBlocksMeta);
      this.reusableBlocksExists = true;
      if (opts?.successKey) this.toast.success(this.t(opts.successKey));
    };

    const onError = (err: any) => {
      if (this.handleContentConflict(err, this.reusableBlocksKey, () => this.loadReusableBlocks())) return;
      this.toast.error(this.t('adminUi.content.reusableBlocks.errors.save'));
    };

    if (this.reusableBlocksExists) {
      this.admin.updateContentBlock(this.reusableBlocksKey, payload).subscribe({ next: onSaved, error: onError });
      return;
    }

    const createPayload = {
      title: 'Reusable blocks',
      body_markdown: 'Internal CMS reusable blocks storage.',
      status: 'draft',
      meta
    };
    this.admin.createContent(this.reusableBlocksKey, createPayload).subscribe({ next: onSaved, error: onError });
  }

  private parseReusableBlocks(meta: Record<string, unknown> | null | undefined): CmsReusableBlock[] {
    const raw = meta?.['snippets'];
    if (!Array.isArray(raw)) return [];
    const parsed: CmsReusableBlock[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const id = typeof rec['id'] === 'string' ? rec['id'].trim() : '';
      const title = typeof rec['title'] === 'string' ? rec['title'].trim() : '';
      const block = rec['block'];
      if (!id || !title || !block || typeof block !== 'object') continue;
      if (seen.has(id)) continue;
      seen.add(id);
      parsed.push({ id, title, block: block as Omit<PageBlockDraft, 'key'> });
    }
    return parsed;
  }

  private deepCloneJson<T>(value: T): T {
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return value;
    }
  }

  private slugifyReusableBlockId(value: string): string {
    const raw = (value || '').trim().toLowerCase();
    if (!raw) return '';
    const cleaned = raw
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-');
    return cleaned || '';
  }

  onPageBlocksKeyChange(next: PageBuilderKey): void {
    const safePageKey = this.safePageRecordKey(next);
    if (!safePageKey || this.pageBlocksKey === safePageKey) return;
    this.pageBlocksKey = safePageKey;
    this.pagePreviewForSlug = null;
    this.pagePreviewToken = null;
    this.pagePreviewExpiresAt = null;
    this.pagePreviewOrigin = null;
    this.pagePreviewNonce = 0;
    this.ensureNewPageBlockTypeForKey(safePageKey);
    this.loadPageBlocks(safePageKey);
  }

  loadPageBlocks(pageKey: PageBuilderKey): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    this.setPageRecordValue(this.pageBlocksMessage, safePageKey, null);
    this.setPageRecordValue(this.pageBlocksError, safePageKey, null);
    this.admin.getContent(safePageKey).subscribe({
		      next: (block) => {
		        this.rememberContentVersion(safePageKey, block);
		        this.setPageRecordValue(this.pageBlocksNeedsTranslationEn, safePageKey, Boolean(block?.needs_translation_en));
		        this.setPageRecordValue(this.pageBlocksNeedsTranslationRo, safePageKey, Boolean(block?.needs_translation_ro));
	        this.setPageRecordValue(this.pageBlocksStatus, safePageKey, this.normalizeContentStatus(block?.status));
	        this.setPageRecordValue(
	          this.pageBlocksPublishedAt,
	          safePageKey,
	          block?.published_at ? this.toLocalDateTime(block.published_at) : ''
	        );
	        this.setPageRecordValue(
	          this.pageBlocksPublishedUntil,
	          safePageKey,
	          block?.published_until ? this.toLocalDateTime(block.published_until) : ''
	        );
		        const metaObj = this.toRecord(block?.meta);
	        this.setPageRecordValue(this.pageBlocksMeta, safePageKey, metaObj);
	        this.setPageRecordValue(this.pageBlocksRequiresAuth, safePageKey, Boolean(metaObj['requires_auth']));
	        this.pageBlocks[safePageKey] = this.parsePageBlocksDraft(metaObj);
	        this.ensurePageDraft(safePageKey).initFromServer(this.currentPageDraftState(safePageKey));
	      },
	      error: (err) => {
	        if (err?.status === 404) {
	          this.deleteRecordValue(this.contentVersions, safePageKey);
          this.setPageRecordValue(this.pageBlocksNeedsTranslationEn, safePageKey, false);
          this.setPageRecordValue(this.pageBlocksNeedsTranslationRo, safePageKey, false);
          this.setPageRecordValue(this.pageBlocksStatus, safePageKey, 'draft');
          this.setPageRecordValue(this.pageBlocksPublishedAt, safePageKey, '');
          this.setPageRecordValue(this.pageBlocksPublishedUntil, safePageKey, '');
	          this.setPageRecordValue(this.pageBlocksMeta, safePageKey, {});
	          this.setPageRecordValue(this.pageBlocksRequiresAuth, safePageKey, false);
	          this.pageBlocks[safePageKey] = [];
	          this.ensurePageDraft(safePageKey).initFromServer(this.currentPageDraftState(safePageKey));
	          return;
	        }
	        this.setPageRecordValue(this.pageBlocksError, safePageKey, this.t('adminUi.site.pages.builder.errors.load'));
	      }
    });
  }

	  createCustomPage(): void {
	    const title = (this.newCustomPageTitle || '').trim();
	    if (!title) return;
	    const baseSlug = this.slugifyPageSlug(title);
    if (this.isReservedPageSlug(baseSlug)) {
      this.toast.error(this.t('adminUi.site.pages.errors.reservedTitle'), this.t('adminUi.site.pages.errors.reservedCopy'));
      return;
    }
    const existing = new Set((this.contentPages || []).map((p) => p.slug));
    let slug = baseSlug;
    let counter = 2;
    while (existing.has(slug)) {
      slug = `${baseSlug}-${counter++}`;
    }
    const key = `page.${slug}` as PageBuilderKey;
    this.creatingCustomPage = true;
    const published_at =
      this.newCustomPageStatus === 'published'
        ? this.newCustomPagePublishedAt
          ? new Date(this.newCustomPagePublishedAt).toISOString()
          : null
        : null;
    const published_until =
      this.newCustomPageStatus === 'published'
        ? this.newCustomPagePublishedUntil
          ? new Date(this.newCustomPagePublishedUntil).toISOString()
          : null
        : null;
	    const payload = {
	      title,
	      body_markdown: 'Page builder',
	      status: this.newCustomPageStatus,
	      published_at,
	      published_until,
	      meta: { version: 2, blocks: this.pageTemplateBlocks(this.newCustomPageTemplate) }
	    };
    const done = () => {
      this.creatingCustomPage = false;
    };
    this.admin.createContent(key, payload).subscribe({
	      next: () => {
	        done();
	        this.toast.success(this.t('adminUi.site.pages.success.created'));
	        this.newCustomPageTitle = '';
	        this.newCustomPageTemplate = 'blank';
	        this.newCustomPageStatus = 'draft';
	        this.newCustomPagePublishedAt = '';
	        this.newCustomPagePublishedUntil = '';
	        this.loadContentPages();
        this.pageBlocksKey = key;
        this.loadPageBlocks(key);
      },
      error: (err) => {
        done();
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.toast.error(detail || this.t('adminUi.site.pages.errors.create'));
      }
    });
	  }

	  private pageTemplateBlocks(template: PageCreationTemplate): Array<Record<string, unknown>> {
	    const prose: CmsBlockLayout = { spacing: 'none', background: 'none', align: 'left', max_width: 'prose' };
	    const textBlock = (
	      key: string,
	      titleEn: string,
	      titleRo: string,
	      bodyEn: string,
	      bodyRo: string,
	      layout: CmsBlockLayout = prose
	    ): Record<string, unknown> => ({
	      key,
	      type: 'text',
	      enabled: true,
	      title: { en: titleEn, ro: titleRo },
	      body_markdown: { en: bodyEn, ro: bodyRo },
	      layout
	    });

	    if (template === 'about') {
	      return [
	        textBlock(
	          'about_intro',
	          'Our story',
	          'Povestea noastră',
	          `Write a short introduction about who you are and what you make.\n\n- Where are you based?\n- What inspires your work?\n- What materials do you use?`,
	          `Scrie o introducere scurtă despre cine ești și ce creezi.\n\n- Unde lucrezi?\n- Ce te inspiră?\n- Ce materiale folosești?`
	        ),
	        textBlock(
	          'about_process',
	          "How it's made",
	          'Cum este realizat',
	          `Describe your process step by step.\n\n1. Idea & sketch\n2. Materials\n3. Crafting\n4. Finishing touches`,
	          `Descrie procesul pas cu pas.\n\n1. Idee și schiță\n2. Materiale\n3. Realizare\n4. Finisaje`
	        ),
	        textBlock(
	          'about_care',
	          'Care & longevity',
	          'Îngrijire și durabilitate',
	          `Add care instructions and tips to keep items looking great.\n\nTip: link to your Care page if you have one.`,
	          `Adaugă instrucțiuni de îngrijire și sfaturi pentru păstrarea produselor.\n\nSfat: adaugă un link către pagina de Îngrijire dacă există.`
	        )
	      ];
	    }

	    if (template === 'faq') {
	      return [
	        textBlock(
	          'faq_intro',
	          'Frequently asked questions',
	          'Întrebări frecvente',
	          `Add your FAQs here.\n\n### How long does shipping take?\nAnswer...\n\n### Do you take custom orders?\nAnswer...\n\n### How can I contact you?\nAnswer...`,
	          `Adaugă aici întrebările frecvente.\n\n### Cât durează livrarea?\nRăspuns...\n\n### Realizezi comenzi personalizate?\nRăspuns...\n\n### Cum te pot contacta?\nRăspuns...`
	        ),
	        textBlock(
	          'faq_policies',
	          'Policies',
	          'Politici',
	          `### Returns & cancellations\nAnswer...\n\n### Payments\nAnswer...`,
	          `### Returnări și anulări\nRăspuns...\n\n### Plăți\nRăspuns...`
	        )
	      ];
	    }

	    if (template === 'shipping') {
	      return [
	        textBlock(
	          'shipping_rates',
	          'Shipping',
	          'Livrare',
	          `Explain shipping zones, pricing, and estimated delivery times.\n\n- Processing time: ...\n- Delivery time: ...\n- Courier: ...`,
	          `Explică zonele de livrare, costurile și timpul estimat.\n\n- Timp de procesare: ...\n- Timp de livrare: ...\n- Curier: ...`
	        ),
	        textBlock(
	          'shipping_tracking',
	          'Tracking & delivery issues',
	          'Urmărire și probleme la livrare',
	          `Explain tracking, failed delivery attempts, and how customers can get help.\n\nEmail: ...\nPhone: ...`,
	          `Explică urmărirea coletului, tentativele eșuate și cum poate clientul primi ajutor.\n\nEmail: ...\nTelefon: ...`
	        )
	      ];
	    }

	    if (template === 'returns') {
	      return [
	        textBlock(
	          'returns_policy',
	          'Returns & cancellations',
	          'Returnări și anulări',
	          `Explain your return window, condition requirements, and cancellation policy.\n\n- Window: ... days\n- Condition: ...\n- How to start a return: ...`,
	          `Explică perioada de retur, condițiile produsului și politica de anulare.\n\n- Perioadă: ... zile\n- Condiție: ...\n- Cum începi un retur: ...`
	        ),
	        textBlock(
	          'returns_refunds',
	          'Refunds',
	          'Rambursări',
	          `Explain how refunds are issued and typical timelines.\n\n- Payment method: ...\n- Timeline: ...`,
	          `Explică modul de rambursare și termenele obișnuite.\n\n- Metodă de plată: ...\n- Termen: ...`
	        )
	      ];
	    }

	    return [];
	  }

	  loadContentRedirects(reset: boolean = false): void {
	    if (reset) {
	      this.redirectsMeta = { ...this.redirectsMeta, page: 1 };
    }
    this.redirectsLoading = true;
    this.redirectsError = null;
    const q = (this.redirectsQuery || '').trim();
    this.admin
      .listContentRedirects({
        q: q || undefined,
        page: this.redirectsMeta.page,
        limit: this.redirectsMeta.limit
      })
      .subscribe({
        next: (res) => {
          this.redirects = res?.items || [];
          this.redirectsMeta = res?.meta || { total_items: 0, total_pages: 1, page: 1, limit: this.redirectsMeta.limit };
          this.redirectsLoading = false;
        },
        error: () => {
          this.redirectsLoading = false;
          this.redirects = [];
          this.redirectsMeta = { ...this.redirectsMeta, total_items: 0, total_pages: 1 };
          this.redirectsError = this.t('adminUi.site.pages.redirects.errors.load');
        }
      });
  }

  setRedirectsPage(page: number): void {
    const next = Math.max(1, Math.min(Number(page) || 1, this.redirectsMeta.total_pages || 1));
    if (next === this.redirectsMeta.page) return;
    this.redirectsMeta = { ...this.redirectsMeta, page: next };
    this.loadContentRedirects();
  }

  deleteContentRedirect(id: string): void {
    const value = (id || '').trim();
    if (!value) return;
    if (!window.confirm(this.t('adminUi.site.pages.redirects.deleteConfirm'))) return;
    this.admin.deleteContentRedirect(value).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.site.pages.redirects.success.deleted'));
        this.loadContentRedirects(true);
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.toast.error(detail || this.t('adminUi.site.pages.redirects.errors.delete'));
      }
    });
  }

  exportContentRedirects(): void {
    if (this.redirectsExporting) return;
    this.redirectsExporting = true;
    const q = (this.redirectsQuery || '').trim();
    this.admin.exportContentRedirects({ q: q || undefined }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const stamp = new Date().toISOString().slice(0, 10);
        a.download = `content-redirects-${stamp}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        this.redirectsExporting = false;
        this.toast.success(this.t('adminUi.site.pages.redirects.success.export'));
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.redirectsExporting = false;
        this.toast.error(detail || this.t('adminUi.site.pages.redirects.errors.export'));
      }
    });
  }

  importContentRedirects(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] || null;
    if (input) input.value = '';
    if (!file) return;
    if (this.redirectsImporting) return;
    this.redirectsImporting = true;
    this.redirectsImportResult = null;
    this.admin.importContentRedirects(file).subscribe({
      next: (res) => {
        this.redirectsImportResult = res || null;
        this.redirectsImporting = false;
        this.toast.success(this.t('adminUi.site.pages.redirects.success.import'));
        this.loadContentRedirects(true);
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.redirectsImporting = false;
        this.toast.error(detail || this.t('adminUi.site.pages.redirects.errors.import'));
      }
    });
  }

  createContentRedirect(): void {
    if (this.redirectCreateSaving) return;
    const from = (this.redirectCreateFrom || '').trim();
    const to = (this.redirectCreateTo || '').trim();
    if (!from || !to) return;

    this.redirectCreateSaving = true;
    this.admin.upsertContentRedirect({ from_key: from, to_key: to }).subscribe({
      next: () => {
        this.redirectCreateSaving = false;
        this.redirectCreateFrom = '';
        this.redirectCreateTo = '';
        this.toast.success(this.t('adminUi.site.pages.redirects.success.created'));
        this.loadContentRedirects(true);
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.redirectCreateSaving = false;
        this.toast.error(detail || this.t('adminUi.site.pages.redirects.errors.create'));
      }
    });
  }

  private findReplaceKeyPrefix(): string | undefined {
    if (this.findReplaceScope === 'blog') return 'blog.';
    if (this.findReplaceScope === 'home') return 'home.';
    if (this.findReplaceScope === 'site') return 'site.';
    if (this.findReplaceScope === 'pages') return 'page.';
    return undefined;
  }

  private findReplacePayloadKey(payload: { find: string; replace: string; key_prefix?: string | null; case_sensitive: boolean }): string {
    return JSON.stringify({
      find: payload.find,
      replace: payload.replace,
      key_prefix: payload.key_prefix ?? null,
      case_sensitive: payload.case_sensitive
    });
  }

  previewFindReplace(): void {
    if (this.findReplaceLoading || this.findReplaceApplying) return;
    const find = (this.findReplaceFind || '').trim();
    if (!find) {
      this.toast.error(this.t('adminUi.content.findReplace.errors.findRequired'));
      return;
    }
    const payload = {
      find,
      replace: this.findReplaceReplace || '',
      key_prefix: this.findReplaceKeyPrefix() ?? undefined,
      case_sensitive: this.findReplaceCaseSensitive,
      limit: 200
    };

    this.findReplaceLoading = true;
    this.findReplaceError = null;
    this.findReplacePreview = null;
    this.findReplaceApplyResult = null;
    this.findReplacePreviewKey = null;

    this.admin.previewFindReplaceContent(payload).subscribe({
      next: (res) => {
        this.findReplacePreview = res || null;
        this.findReplaceLoading = false;
        this.findReplacePreviewKey = this.findReplacePayloadKey({
          find: payload.find,
          replace: payload.replace,
          key_prefix: payload.key_prefix ?? null,
          case_sensitive: payload.case_sensitive
        });
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.findReplaceError = detail || this.t('adminUi.content.findReplace.errors.preview');
        this.findReplacePreview = null;
        this.findReplaceLoading = false;
      }
    });
  }

  applyFindReplace(): void {
    if (this.findReplaceLoading || this.findReplaceApplying) return;
    const find = (this.findReplaceFind || '').trim();
    if (!find) {
      this.toast.error(this.t('adminUi.content.findReplace.errors.findRequired'));
      return;
    }
    const payload = {
      find,
      replace: this.findReplaceReplace || '',
      key_prefix: this.findReplaceKeyPrefix() ?? undefined,
      case_sensitive: this.findReplaceCaseSensitive
    };
    const key = this.findReplacePayloadKey(payload);

    if (!this.findReplacePreview || this.findReplacePreviewKey !== key) {
      this.toast.error(this.t('adminUi.content.findReplace.errors.previewFirst'));
      return;
    }

    const items = this.findReplacePreview.total_items || 0;
    const matches = this.findReplacePreview.total_matches || 0;
    if (!window.confirm(this.t('adminUi.content.findReplace.confirms.apply', { items, matches }))) return;

    this.findReplaceApplying = true;
    this.findReplaceError = null;

    this.admin.applyFindReplaceContent(payload).subscribe({
      next: (res) => {
        this.findReplaceApplyResult = res || null;
        this.findReplaceApplying = false;
        this.toast.success(
          this.t('adminUi.content.findReplace.success.apply', {
            blocks: res?.updated_blocks ?? 0,
            replacements: res?.total_replacements ?? 0
          })
        );
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.findReplaceApplying = false;
        this.toast.error(detail || this.t('adminUi.content.findReplace.errors.apply'));
      }
    });
  }

  runLinkCheck(keyOverride?: string): void {
    const key = (keyOverride ?? this.linkCheckKey ?? '').trim();
    if (!key) return;
    this.linkCheckKey = key;
    this.linkCheckLoading = true;
    this.linkCheckError = null;
    this.linkCheckIssues = [];
    this.admin.linkCheckContent(key).subscribe({
      next: (resp) => {
        this.linkCheckIssues = resp?.issues || [];
        this.linkCheckLoading = false;
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.linkCheckError = detail || this.t('adminUi.content.linkCheck.errors.load');
        this.linkCheckIssues = [];
        this.linkCheckLoading = false;
      }
    });
  }

  redirectKeyToUrl(key: string): string {
    const value = (key || '').trim();
    if (value.startsWith('page.')) {
      const slug = value.split('.', 2)[1] || '';
      return `/pages/${slug}`;
    }
    return value;
  }

  pageKeySupportsRequiresAuth(key: string): boolean {
    return (key || '').trim().startsWith('page.');
  }

  pageBlockTypeLabelKey(type: PageBlockType): string {
    if (type === 'image') return 'adminUi.home.sections.blocks.image';
    if (type === 'columns') return 'adminUi.home.sections.blocks.columns';
    if (type === 'cta') return 'adminUi.home.sections.blocks.cta';
    if (type === 'faq') return 'adminUi.home.sections.blocks.faq';
    if (type === 'testimonials') return 'adminUi.home.sections.blocks.testimonials';
    if (type === 'product_grid') return 'adminUi.home.sections.blocks.product_grid';
    if (type === 'form') return 'adminUi.home.sections.blocks.form';
    if (type === 'gallery') return 'adminUi.home.sections.blocks.gallery';
    if (type === 'banner') return 'adminUi.home.sections.blocks.banner';
    if (type === 'carousel') return 'adminUi.home.sections.blocks.carousel';
    return 'adminUi.home.sections.blocks.text';
  }

  allowedPageBlockTypesForKey(pageKey: PageBuilderKey): PageBlockType[] {
    const allowed = cmsGlobalSectionAllowedTypes(pageKey);
    if (allowed?.length) return [...allowed];
    return this.allPageBlockTypes;
  }

  allowedCmsLibraryTypes(pageKey: PageBuilderKey): ReadonlyArray<CmsBlockLibraryBlockType> | null {
    const allowed = cmsGlobalSectionAllowedTypes(pageKey);
    if (!allowed || !allowed.length) return null;
    return allowed as ReadonlyArray<CmsBlockLibraryBlockType>;
  }

  private ensureNewPageBlockTypeForKey(pageKey: PageBuilderKey): void {
    const allowed = this.allowedPageBlockTypesForKey(pageKey);
    if (!allowed.length) return;
    if (!allowed.includes(this.newPageBlockType)) {
      this.newPageBlockType = allowed[0];
    }
  }

  canRenamePageKey(key: string): boolean {
    const value = (key || '').trim();
    if (!value.startsWith('page.')) return false;
    if (value === 'page.about' || value === 'page.contact' || value === 'page.faq' || value === 'page.shipping') return false;
    return true;
  }

  renameCustomPageUrl(): void {
    const pageKey = this.pageBlocksKey;
    if (!this.canRenamePageKey(pageKey)) return;
    const oldSlug = pageKey.split('.', 2)[1] || '';
    const entered = window.prompt(this.t('adminUi.site.pages.builder.changeUrlPrompt'), oldSlug);
    if (entered === null) return;
    const nextSlug = this.slugifyPageSlug(entered);
    if (!nextSlug || nextSlug === oldSlug) {
      this.toast.error(this.t('adminUi.site.pages.builder.errors.rename'));
      return;
    }
    if (this.isReservedPageSlug(nextSlug)) {
      this.toast.error(this.t('adminUi.site.pages.errors.reservedTitle'), this.t('adminUi.site.pages.errors.reservedCopy'));
      return;
    }
    if (
      !window.confirm(
        this.t('adminUi.site.pages.builder.changeUrlConfirm', { old: oldSlug, next: nextSlug })
      )
    ) {
      return;
    }
    this.admin.renameContentPage(oldSlug, nextSlug).subscribe({
      next: (res) => {
        this.toast.success(this.t('adminUi.site.pages.builder.success.rename'));
        this.pageBlocksKey = res.new_key as PageBuilderKey;
        this.loadContentPages();
        this.loadPageBlocks(this.pageBlocksKey);
        const wantRedirect = window.confirm(
          this.t('adminUi.site.pages.builder.redirectConfirm', { old: oldSlug, next: nextSlug })
        );
        if (!wantRedirect) return;
        this.admin.upsertContentRedirect({ from_key: res.old_key, to_key: res.new_key }).subscribe({
          next: () => {
            this.toast.success(this.t('adminUi.site.pages.redirects.success.created'));
            this.loadContentRedirects(true);
          },
          error: (err) => {
            const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
            this.toast.error(detail || this.t('adminUi.site.pages.redirects.errors.create'));
          }
        });
      },
      error: (err) => {
        const detail = typeof err?.error?.detail === 'string' ? String(err.error.detail) : '';
        this.toast.error(detail || this.t('adminUi.site.pages.builder.errors.rename'));
      }
    });
  }

  private isReservedPageSlug(slug: string): boolean {
    const value = (slug || '').trim().toLowerCase();
    if (!value) return true;
    const reserved = new Set([
      'admin',
      'account',
      'auth',
      'blog',
      'cart',
      'checkout',
      'contact',
      'error',
      'home',
      'login',
      'register',
      'receipt',
      'pages',
      'products',
      'shop',
      'tickets',
      'about',
      'password-reset'
    ]);
    return reserved.has(value);
  }

  private slugifyPageSlug(value: string): string {
    const raw = (value || '').trim().toLowerCase();
    if (!raw) return 'page';
    const cleaned = raw
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-');
    return cleaned || 'page';
  }

  private parsePageBlocksDraft(meta: Record<string, unknown> | null | undefined): PageBlockDraft[] {
    const rawBlocks = meta?.['blocks'];
    if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) return [];

    const configured: PageBlockDraft[] = [];
    const seen = new Set<string>();

    for (const [idx, raw] of rawBlocks.entries()) {
      if (!raw || typeof raw !== 'object') continue;
      const rec = raw as Record<string, unknown>;
      const typeRaw = typeof rec['type'] === 'string' ? String(rec['type']).trim() : '';
      if (
        typeRaw !== 'text' &&
        typeRaw !== 'columns' &&
        typeRaw !== 'cta' &&
        typeRaw !== 'faq' &&
        typeRaw !== 'testimonials' &&
        typeRaw !== 'product_grid' &&
        typeRaw !== 'form' &&
        typeRaw !== 'image' &&
        typeRaw !== 'gallery' &&
        typeRaw !== 'banner' &&
        typeRaw !== 'carousel'
      ) {
        continue;
      }
      const key = typeof rec['key'] === 'string' ? String(rec['key']).trim() : '';
      const finalKey = key || `${typeRaw}_${idx + 1}`;
      if (!finalKey || seen.has(finalKey)) continue;
      seen.add(finalKey);

      const enabled = rec['enabled'] === false ? false : true;
      const draft: PageBlockDraft = {
        key: finalKey,
        type: typeRaw,
        enabled,
        title: this.toLocalizedText(rec['title']),
        body_markdown: this.emptyLocalizedText(),
        columns: [
          { title: this.emptyLocalizedText(), body_markdown: this.emptyLocalizedText() },
          { title: this.emptyLocalizedText(), body_markdown: this.emptyLocalizedText() }
        ],
        columns_breakpoint: 'md',
        cta_label: this.emptyLocalizedText(),
        cta_url: '',
        cta_new_tab: false,
        faq_items: [{ question: this.emptyLocalizedText(), answer_markdown: this.emptyLocalizedText() }],
        testimonials: [{ quote_markdown: this.emptyLocalizedText(), author: this.emptyLocalizedText(), role: this.emptyLocalizedText() }],
        product_grid_source: 'category',
        product_grid_category_slug: '',
        product_grid_collection_slug: '',
        product_grid_product_slugs: '',
        product_grid_limit: 6,
        form_type: 'contact',
        form_topic: 'contact',
        url: '',
        link_url: '',
        focal_x: 50,
        focal_y: 50,
        alt: this.emptyLocalizedText(),
        caption: this.emptyLocalizedText(),
        images: [],
        slide: this.emptySlideDraft(),
        slides: [this.emptySlideDraft()],
        settings: this.defaultCarouselSettings(),
        layout: this.toCmsBlockLayout(rec['layout'])
      };

      if (typeRaw === 'text') {
        draft.body_markdown = this.toLocalizedText(rec['body_markdown']);
      } else if (typeRaw === 'columns') {
        const columnsRaw = rec['columns'];
        const cols: CmsColumnsColumnDraft[] = [];
        if (Array.isArray(columnsRaw)) {
          for (const colRaw of columnsRaw) {
            if (!colRaw || typeof colRaw !== 'object') continue;
            const colRec = colRaw as Record<string, unknown>;
            cols.push({
              title: this.toLocalizedText(colRec['title']),
              body_markdown: this.toLocalizedText(colRec['body_markdown'])
            });
            if (cols.length >= 3) break;
          }
        }
        if (cols.length >= 2) draft.columns = cols;
        const bpRaw = rec['columns_breakpoint'] ?? rec['breakpoint'] ?? rec['stack_at'];
        const bp = typeof bpRaw === 'string' ? String(bpRaw).trim() : '';
        draft.columns_breakpoint = bp === 'sm' || bp === 'md' || bp === 'lg' ? bp : 'md';
      } else if (typeRaw === 'cta') {
        draft.body_markdown = this.toLocalizedText(rec['body_markdown']);
        draft.cta_label = this.toLocalizedText(rec['cta_label']);
        draft.cta_url = typeof rec['cta_url'] === 'string' ? String(rec['cta_url']).trim() : '';
        draft.cta_new_tab = this.toBooleanValue(rec['cta_new_tab'], false);
      } else if (typeRaw === 'faq') {
        const itemsRaw = rec['items'];
        const items: CmsFaqItemDraft[] = [];
        if (Array.isArray(itemsRaw)) {
          for (const itemRaw of itemsRaw) {
            if (!itemRaw || typeof itemRaw !== 'object') continue;
            const itemRec = itemRaw as Record<string, unknown>;
            items.push({
              question: this.toLocalizedText(itemRec['question']),
              answer_markdown: this.toLocalizedText(itemRec['answer_markdown'])
            });
            if (items.length >= 20) break;
          }
        }
        if (items.length) draft.faq_items = items;
      } else if (typeRaw === 'testimonials') {
        const itemsRaw = rec['items'];
        const items: CmsTestimonialDraft[] = [];
        if (Array.isArray(itemsRaw)) {
          for (const itemRaw of itemsRaw) {
            if (!itemRaw || typeof itemRaw !== 'object') continue;
            const itemRec = itemRaw as Record<string, unknown>;
            items.push({
              quote_markdown: this.toLocalizedText(itemRec['quote_markdown']),
              author: this.toLocalizedText(itemRec['author']),
              role: this.toLocalizedText(itemRec['role'])
            });
            if (items.length >= 12) break;
          }
        }
        if (items.length) draft.testimonials = items;
      } else if (typeRaw === 'product_grid') {
        const sourceRaw = typeof rec['source'] === 'string' ? String(rec['source']).trim().toLowerCase() : '';
        draft.product_grid_source = sourceRaw === 'collection' ? 'collection' : sourceRaw === 'products' ? 'products' : 'category';
        draft.product_grid_category_slug = typeof rec['category_slug'] === 'string' ? String(rec['category_slug']).trim() : '';
        draft.product_grid_collection_slug = typeof rec['collection_slug'] === 'string' ? String(rec['collection_slug']).trim() : '';
        const slugsRaw = rec['product_slugs'];
        const slugs: string[] = [];
        const pushSlug = (value: string) => {
          const cleaned = value.trim();
          if (!cleaned) return;
          if (slugs.includes(cleaned)) return;
          slugs.push(cleaned);
        };
        if (Array.isArray(slugsRaw)) {
          for (const item of slugsRaw) {
            if (typeof item !== 'string') continue;
            pushSlug(item);
            if (slugs.length >= 50) break;
          }
        } else if (typeof slugsRaw === 'string') {
          for (const part of slugsRaw.split(/[,\n]/g)) {
            pushSlug(part);
            if (slugs.length >= 50) break;
          }
        }
        draft.product_grid_product_slugs = slugs.join('\n');
        const desired = Number(rec['limit']);
        draft.product_grid_limit = Number.isFinite(desired) ? Math.max(1, Math.min(24, Math.trunc(desired))) : 6;
      } else if (typeRaw === 'form') {
        const formTypeRaw = typeof rec['form_type'] === 'string' ? String(rec['form_type']).trim().toLowerCase() : '';
        draft.form_type = formTypeRaw === 'newsletter' ? 'newsletter' : 'contact';
        const topicRaw = typeof rec['topic'] === 'string' ? String(rec['topic']).trim().toLowerCase() : '';
        draft.form_topic = topicRaw === 'support' || topicRaw === 'refund' || topicRaw === 'dispute' ? (topicRaw as CmsContactTopic) : 'contact';
      } else if (typeRaw === 'image') {
        draft.url = typeof rec['url'] === 'string' ? String(rec['url']).trim() : '';
        draft.link_url = typeof rec['link_url'] === 'string' ? String(rec['link_url']).trim() : '';
        draft.alt = this.toLocalizedText(rec['alt']);
        draft.caption = this.toLocalizedText(rec['caption']);
        draft.focal_x = this.toFocalValue(rec['focal_x']);
        draft.focal_y = this.toFocalValue(rec['focal_y']);
      } else if (typeRaw === 'gallery') {
        const imagesRaw = rec['images'];
        if (Array.isArray(imagesRaw)) {
          for (const imgRaw of imagesRaw) {
            if (!imgRaw || typeof imgRaw !== 'object') continue;
            const imgRec = imgRaw as Record<string, unknown>;
            const url = typeof imgRec['url'] === 'string' ? String(imgRec['url']).trim() : '';
            if (!url) continue;
            draft.images.push({
              url,
              alt: this.toLocalizedText(imgRec['alt']),
              caption: this.toLocalizedText(imgRec['caption']),
              focal_x: this.toFocalValue(imgRec['focal_x']),
              focal_y: this.toFocalValue(imgRec['focal_y'])
            });
          }
        }
      } else if (typeRaw === 'banner') {
        draft.slide = this.toSlideDraft(rec['slide']);
      } else if (typeRaw === 'carousel') {
        const slidesRaw = rec['slides'];
        const slides: SlideDraft[] = [];
        if (Array.isArray(slidesRaw)) {
          for (const slideRaw of slidesRaw) slides.push(this.toSlideDraft(slideRaw));
        }
        draft.slides = slides.length ? slides : [this.emptySlideDraft()];
        draft.settings = this.toCarouselSettingsDraft(rec['settings']);
      }

      configured.push(draft);
    }

    return configured;
  }

  setPageInsertDragActive(active: boolean): void {
    this.pageInsertDragActive = active;
  }

  addPageBlockFromLibrary(pageKey: PageBuilderKey, type: CmsBlockLibraryBlockType, template: CmsBlockLibraryTemplate): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    const current = [...(this.pageBlocks[safePageKey] || [])];
    this.insertPageBlockAt(safePageKey, type, current.length, template);
  }

	  private insertPageBlockAt(pageKey: PageBuilderKey, type: CmsBlockLibraryBlockType, index: number, template: CmsBlockLibraryTemplate): string | null {
      const safePageKey = this.safePageRecordKey(pageKey);
	    const allowed = this.allowedPageBlockTypesForKey(safePageKey);
	    if (allowed.length && !allowed.includes(type as PageBlockType)) {
	      this.toast.error(this.t('adminUi.site.pages.builder.errors.blockTypeNotAllowed'));
	      return null;
	    }

	    const current = [...(this.pageBlocks[safePageKey] || [])];
	    const existing = new Set(current.map((b) => b.key));
	    const base = `${type}_${Date.now()}`;
    let key = base;
    let suffix = 1;
    while (existing.has(key)) {
      key = `${base}_${suffix++}`;
    }
    const draft: PageBlockDraft = {
      key,
      type,
      enabled: true,
      title: this.emptyLocalizedText(),
      body_markdown: this.emptyLocalizedText(),
      columns: [
        { title: this.emptyLocalizedText(), body_markdown: this.emptyLocalizedText() },
        { title: this.emptyLocalizedText(), body_markdown: this.emptyLocalizedText() }
      ],
      columns_breakpoint: 'md',
      cta_label: this.emptyLocalizedText(),
      cta_url: '',
      cta_new_tab: false,
      faq_items: [{ question: this.emptyLocalizedText(), answer_markdown: this.emptyLocalizedText() }],
      testimonials: [{ quote_markdown: this.emptyLocalizedText(), author: this.emptyLocalizedText(), role: this.emptyLocalizedText() }],
      product_grid_source: 'category',
      product_grid_category_slug: '',
      product_grid_collection_slug: '',
      product_grid_product_slugs: '',
      product_grid_limit: 6,
      form_type: 'contact',
      form_topic: 'contact',
      url: '',
      link_url: '',
      focal_x: 50,
      focal_y: 50,
      alt: this.emptyLocalizedText(),
      caption: this.emptyLocalizedText(),
      images: [],
      slide: this.emptySlideDraft(),
      slides: [this.emptySlideDraft()],
      settings: this.defaultCarouselSettings(),
      layout: this.defaultCmsBlockLayout()
    };

	    if (template === 'starter') {
	      this.applyStarterTemplateToCustomBlock(type, draft);
	    }

	    const safeIndex = Math.max(0, Math.min(index, current.length));
	    current.splice(safeIndex, 0, draft);
	    this.pageBlocks[safePageKey] = current;
	    return key;
	  }

  private applyStarterTemplateToCustomBlock(type: CmsBlockLibraryBlockType, block: PageBlockDraft | HomeBlockDraft): void {
    if (type === 'text') {
      block.title = { en: 'Section title', ro: 'Titlu secțiune' };
      block.body_markdown = { en: 'Write your content here...', ro: 'Scrie conținutul aici...' };
      return;
    }

    if (type === 'columns') {
      block.title = { en: 'Columns', ro: 'Coloane' };
      block.columns_breakpoint = 'md';
      block.columns = [
        {
          title: { en: 'Column 1', ro: 'Coloana 1' },
          body_markdown: { en: 'Add text here…', ro: 'Adaugă text aici…' }
        },
        {
          title: { en: 'Column 2', ro: 'Coloana 2' },
          body_markdown: { en: 'Add text here…', ro: 'Adaugă text aici…' }
        }
      ];
      return;
    }

    if (type === 'cta') {
      block.title = { en: 'Call to action', ro: 'Apel la acțiune' };
      block.body_markdown = { en: 'Add a short message and a button.', ro: 'Adaugă un mesaj scurt și un buton.' };
      block.cta_label = { en: 'Shop now', ro: 'Cumpără acum' };
      block.cta_url = '/shop';
      return;
    }

    if (type === 'faq') {
      block.title = { en: 'FAQ', ro: 'Întrebări frecvente' };
      block.faq_items = [
        {
          question: { en: 'How long does shipping take?', ro: 'Cât durează livrarea?' },
          answer_markdown: { en: 'Usually 1–3 business days.', ro: 'De obicei 1–3 zile lucrătoare.' }
        },
        {
          question: { en: 'Can I return an item?', ro: 'Pot returna un produs?' },
          answer_markdown: { en: 'Yes. Please contact us for details.', ro: 'Da. Te rugăm să ne contactezi pentru detalii.' }
        }
      ];
      return;
    }

    if (type === 'testimonials') {
      block.title = { en: 'Testimonials', ro: 'Testimoniale' };
      block.testimonials = [
        {
          quote_markdown: { en: '“Amazing quality and fast delivery.”', ro: '„Calitate excelentă și livrare rapidă.”' },
          author: { en: 'Customer name', ro: 'Nume client' },
          role: { en: 'Verified buyer', ro: 'Client verificat' }
        },
        {
          quote_markdown: { en: '“Beautiful craftsmanship.”', ro: '„Măiestrie deosebită.”' },
          author: { en: 'Customer name', ro: 'Nume client' },
          role: { en: 'Verified buyer', ro: 'Client verificat' }
        }
      ];
      return;
    }

    if (type === 'product_grid') {
      block.title = { en: 'Shoppable grid', ro: 'Grilă de produse' };
      block.product_grid_source = 'category';
      block.product_grid_limit = 6;
      return;
    }

    if (type === 'form') {
      block.title = { en: 'Contact form', ro: 'Formular de contact' };
      block.form_type = 'contact';
      block.form_topic = 'contact';
      return;
    }

    if (type === 'image') {
      block.title = { en: 'Image section', ro: 'Secțiune imagine' };
      block.alt = { en: 'Image description', ro: 'Descriere imagine' };
      block.caption = { en: 'Optional caption', ro: 'Legendă opțională' };
      block.link_url = '/shop';
      return;
    }

    if (type === 'gallery') {
      block.title = { en: 'Gallery', ro: 'Galerie' };
      const makeImage = (): HomeGalleryImageDraft => ({
        url: '',
        alt: { en: 'Image description', ro: 'Descriere imagine' },
        caption: { en: 'Caption', ro: 'Legendă' },
        focal_x: 50,
        focal_y: 50
      });
      block.images = [makeImage(), makeImage(), makeImage()];
      return;
    }

    if (type === 'banner') {
      block.title = { en: 'Banner', ro: 'Banner' };
      block.slide = {
        ...block.slide,
        headline: { en: 'Headline', ro: 'Titlu' },
        subheadline: { en: 'Supporting text', ro: 'Text de suport' },
        cta_label: { en: 'Shop now', ro: 'Cumpără acum' },
        cta_url: '/shop',
        alt: { en: 'Banner image', ro: 'Imagine banner' }
      };
      return;
    }

    const makeSlide = (idx: number): SlideDraft => {
      const slide = this.emptySlideDraft();
      const n = idx + 1;
      slide.headline = { en: `Slide ${n}`, ro: `Slide ${n}` };
      slide.subheadline = { en: 'Supporting text', ro: 'Text de suport' };
      slide.cta_label = { en: 'Shop', ro: 'Cumpără' };
      slide.cta_url = '/shop';
      slide.alt = { en: 'Carousel image', ro: 'Imagine carusel' };
      return slide;
    };

    block.title = { en: 'Carousel', ro: 'Carusel' };
    block.slides = [makeSlide(0), makeSlide(1), makeSlide(2)];
    block.settings = { ...block.settings, autoplay: true, interval_ms: 5000 };
  }

  private readCmsBlockPayload(event: DragEvent): { scope: 'home' | 'page'; type: CmsBlockLibraryBlockType; template: CmsBlockLibraryTemplate } | null {
    const raw = event.dataTransfer?.getData('text/plain');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (parsed.kind !== 'cms-block') return null;
      const scope = parsed.scope;
      if (scope !== 'home' && scope !== 'page') return null;
      const type = parsed.type;
       if (
         type !== 'text' &&
         type !== 'columns' &&
         type !== 'cta' &&
         type !== 'faq' &&
         type !== 'testimonials' &&
         type !== 'product_grid' &&
         type !== 'form' &&
         type !== 'image' &&
         type !== 'gallery' &&
         type !== 'banner' &&
         type !== 'carousel'
       ) {
        return null;
      }
      const template = parsed.template === 'starter' ? 'starter' : 'blank';
      return { scope, type, template };
    } catch {
      return null;
    }
  }

  addPageBlock(pageKey: PageBuilderKey): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    const current = [...(this.pageBlocks[safePageKey] || [])];
    this.insertPageBlockAt(safePageKey, this.newPageBlockType, current.length, 'blank');
  }

  removePageBlock(pageKey: PageBuilderKey, blockKey: string): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).filter((b) => b.key !== blockKey);
  }

	  togglePageBlockEnabled(pageKey: PageBuilderKey, blockKey: string, event: Event): void {
      const safePageKey = this.safePageRecordKey(pageKey);
	    const target = event.target as HTMLInputElement | null;
	    const enabled = target?.checked !== false;
	    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) => (b.key === blockKey ? { ...b, enabled } : b));
	  }

	  pageBlockLabel(block: PageBlockDraft): string {
	    const key = `adminUi.home.sections.blocks.${block.type}`;
	    const translated = this.t(key);
	    return translated !== key ? translated : String(block.type);
	  }

	  movePageBlock(pageKey: PageBuilderKey, blockKey: string, delta: number): void {
      const safePageKey = this.safePageRecordKey(pageKey);
	    const current = [...(this.pageBlocks[safePageKey] || [])];
	    const from = current.findIndex((b) => b.key === blockKey);
	    if (from === -1) return;
	    const to = from + delta;
	    if (to < 0 || to >= current.length) return;
	    const [moved] = current.splice(from, 1);
	    current.splice(to, 0, moved);
	    this.pageBlocks[safePageKey] = current;
	    this.announceCms(
	      this.t('adminUi.content.reorder.moved', { label: this.pageBlockLabel(moved), pos: to + 1, count: current.length })
	    );
	  }

  onPageBlockDragStart(pageKey: PageBuilderKey, blockKey: string): void {
    this.pageInsertDragActive = true;
    this.draggingPageBlocksKey = pageKey;
    this.draggingPageBlockKey = blockKey;
  }

  onPageBlockDragEnd(): void {
    this.draggingPageBlocksKey = null;
    this.draggingPageBlockKey = null;
    this.pageInsertDragActive = false;
  }

	  onPageBlockDragOver(event: DragEvent): void {
	    event.preventDefault();
	  }

	  onCmsMediaDragOver(event: DragEvent): void {
	    if (!this.dragEventHasFiles(event)) return;
	    event.preventDefault();
	    if (event.dataTransfer) {
	      event.dataTransfer.dropEffect = 'copy';
	    }
	  }

	  onPageMediaDropOnContainer(event: DragEvent, pageKey: PageBuilderKey): void {
	    if (event.target !== event.currentTarget) return;
	    const files = this.extractCmsImageFiles(event);
	    if (!files.length) return;
	    event.preventDefault();
      const safePageKey = this.safePageRecordKey(pageKey);
	    const index = (this.pageBlocks[safePageKey] || []).length;
	    void this.insertPageMediaFiles(safePageKey, index, files);
	  }

	  onHomeMediaDropOnContainer(event: DragEvent): void {
	    if (event.target !== event.currentTarget) return;
	    const files = this.extractCmsImageFiles(event);
	    if (!files.length) return;
	    event.preventDefault();
	    void this.insertHomeMediaFiles(this.homeBlocks.length, files);
	  }

	  onPageBlockDropZone(event: DragEvent, pageKey: PageBuilderKey, index: number): void {
      const safePageKey = this.safePageRecordKey(pageKey);
	    event.preventDefault();
	    const current = [...(this.pageBlocks[safePageKey] || [])];

    if (this.draggingPageBlocksKey === safePageKey && this.draggingPageBlockKey) {
      const from = current.findIndex((b) => b.key === this.draggingPageBlockKey);
      if (from === -1) {
        this.onPageBlockDragEnd();
        return;
      }
      const safeIndex = Math.max(0, Math.min(index, current.length));
      const [moved] = current.splice(from, 1);
      const nextIndex = from < safeIndex ? safeIndex - 1 : safeIndex;
      current.splice(nextIndex, 0, moved);
      this.pageBlocks[safePageKey] = current;
      this.onPageBlockDragEnd();
      return;
    }

    const payload = this.readCmsBlockPayload(event);
    if (!payload || payload.scope !== 'page') {
      this.onPageBlockDragEnd();
      return;
    }

	    this.insertPageBlockAt(safePageKey, payload.type, index, payload.template);
	    this.pageInsertDragActive = false;
	  }

	  onPageBlockDrop(event: DragEvent, pageKey: PageBuilderKey, targetKey: string): void {
      const safePageKey = this.safePageRecordKey(pageKey);
	    event.preventDefault();

	    const mediaFiles = this.extractCmsImageFiles(event);
	    if (mediaFiles.length) {
	      const current = [...(this.pageBlocks[safePageKey] || [])];
	      const to = current.findIndex((b) => b.key === targetKey);
	      const safeIndex = to !== -1 ? to : current.length;
	      void this.insertPageMediaFiles(safePageKey, safeIndex, mediaFiles);
	      this.pageInsertDragActive = false;
	      return;
	    }

	    const payload = this.readCmsBlockPayload(event);
	    if (payload?.scope === 'page') {
	      const current = [...(this.pageBlocks[safePageKey] || [])];
	      const to = current.findIndex((b) => b.key === targetKey);
	      if (to !== -1) {
        this.insertPageBlockAt(safePageKey, payload.type, to, payload.template);
      }
      this.pageInsertDragActive = false;
      return;
    }

    if (!this.draggingPageBlocksKey || !this.draggingPageBlockKey) return;
    if (this.draggingPageBlocksKey !== safePageKey) return;
    if (this.draggingPageBlockKey === targetKey) return;

    const current = [...(this.pageBlocks[safePageKey] || [])];
    const from = current.findIndex((b) => b.key === this.draggingPageBlockKey);
    const to = current.findIndex((b) => b.key === targetKey);
    if (from === -1 || to === -1) return;

    const [moved] = current.splice(from, 1);
    const nextIndex = from < to ? to - 1 : to;
    current.splice(nextIndex, 0, moved);
    this.pageBlocks[safePageKey] = current;
    this.onPageBlockDragEnd();
	  }

	  private dragEventHasFiles(event: DragEvent): boolean {
	    const dt = event.dataTransfer;
	    if (!dt) return false;
	    if (dt.files && dt.files.length > 0) return true;
	    try {
	      return Array.from(dt.types || []).includes('Files');
	    } catch {
	      return false;
	    }
	  }

	  private extractCmsImageFiles(event: DragEvent): File[] {
	    const dt = event.dataTransfer;
	    if (!dt) return [];
	    const files = Array.from(dt.files || []);
	    return files.filter((f) => Boolean(f));
	  }

	  private normalizeCmsImageFiles(files: File[]): File[] {
	    const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
	    const maxBytes = 5 * 1024 * 1024;
	    const cleaned = (files || []).filter((f) => f && allowed.has(f.type) && f.size <= maxBytes);
	    if (!cleaned.length) {
	      this.toast.error(this.t('adminUi.content.mediaDrop.errors.noImages'));
	      return [];
	    }
	    return cleaned.slice(0, 12);
	  }

	  private filenameToAltText(filename: string): string {
	    const base = (filename || '').trim().replace(/\.[^/.]+$/, '');
	    const normalized = base
	      .replace(/[_-]+/g, ' ')
	      .replace(/\s+/g, ' ')
	      .trim();
	    if (!normalized) return 'Image';
	    return normalized.length > 80 ? normalized.slice(0, 80).trim() : normalized;
	  }

	  private lastUploadedContentImage(block: any): { url: string; focal_x: number; focal_y: number } | null {
	    const images = Array.isArray(block?.images) ? block.images : [];
	    if (!images.length) return null;
	    const last = images[images.length - 1];
	    const url = typeof last?.url === 'string' ? String(last.url).trim() : '';
	    if (!url) return null;
	    return {
	      url,
	      focal_x: this.toFocalValue(last?.focal_x),
	      focal_y: this.toFocalValue(last?.focal_y)
	    };
	  }

	  private contentTitleForKey(key: string): string {
	    const value = (key || '').trim();
	    return this.contentPages.find((p) => p.key === value)?.title || cmsGlobalSectionDefaultTitle(value) || value || 'Content';
	  }

	  private async uploadCmsImageToKey(contentKey: string, file: File): Promise<{ url: string; focal_x: number; focal_y: number } | null> {
	    try {
	      const block = await firstValueFrom(this.admin.uploadContentImage(contentKey, file));
	      this.rememberContentVersion(contentKey, block);
	      return this.lastUploadedContentImage(block);
	    } catch (err: any) {
	      if (err?.status !== 404) throw err;
	      const createPayload = {
	        title: this.contentTitleForKey(contentKey),
	        body_markdown: 'CMS assets',
	        status: 'draft',
	        meta: { version: 2, blocks: [] }
	      };
	      try {
	        const created = await firstValueFrom(this.admin.createContent(contentKey, createPayload));
	        this.rememberContentVersion(contentKey, created);
	      } catch (createErr: any) {
	        if (createErr?.status !== 409) throw createErr;
	      }
	      const block = await firstValueFrom(this.admin.uploadContentImage(contentKey, file));
	      this.rememberContentVersion(contentKey, block);
	      return this.lastUploadedContentImage(block);
	    }
	  }

  private async insertPageMediaFiles(pageKey: PageBuilderKey, index: number, files: File[]): Promise<void> {
    const safePageKey = this.safePageRecordKey(pageKey);
    const normalized = this.normalizeCmsImageFiles(files);
    if (!normalized.length) return;
    const allowed = this.allowedPageBlockTypesForKey(safePageKey);
	    const canImage = allowed.includes('image');
	    const canGallery = allowed.includes('gallery');

	    const mode: 'image' | 'gallery' | 'multiImage' =
	      normalized.length > 1 ? (canGallery ? 'gallery' : canImage ? 'multiImage' : 'image') : canImage ? 'image' : 'gallery';
	    if (mode === 'image' && !canImage && !canGallery) {
	      this.toast.error(this.t('adminUi.site.pages.builder.errors.blockTypeNotAllowed'));
	      return;
	    }
	    if (mode === 'gallery' && !canGallery && !canImage) {
	      this.toast.error(this.t('adminUi.site.pages.builder.errors.blockTypeNotAllowed'));
	      return;
	    }
	    if (mode === 'multiImage' && !canImage) {
	      this.toast.error(this.t('adminUi.site.pages.builder.errors.blockTypeNotAllowed'));
	      return;
	    }

    const uploads: Array<{ url: string; focal_x: number; focal_y: number; alt: string }> = [];
    for (const file of normalized) {
      const uploaded = await this.uploadCmsImageToKey(String(safePageKey), file);
      if (!uploaded) continue;
      uploads.push({ ...uploaded, alt: this.filenameToAltText(file.name) });
    }
    if (!uploads.length) return;

    const safeIndex = Math.max(0, Math.min(index, (this.pageBlocks[safePageKey] || []).length));
    if (mode === 'image') {
      const createdKey = this.insertPageBlockAt(safePageKey, 'image', safeIndex, 'blank');
      if (!createdKey) return;
      const u = uploads[0];
      this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) =>
        b.key === createdKey
	          ? {
	              ...b,
	              url: u.url,
	              focal_x: u.focal_x,
	              focal_y: u.focal_y,
	              alt: { ...b.alt, en: u.alt, ro: u.alt }
	            }
	          : b
	      );
    } else if (mode === 'gallery') {
      const createdKey = this.insertPageBlockAt(safePageKey, 'gallery', safeIndex, 'blank');
      if (!createdKey) return;
      this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) => {
	        if (b.key !== createdKey || b.type !== 'gallery') return b;
	        return {
	          ...b,
	          images: uploads.map((u) => ({
	            url: u.url,
	            alt: { en: u.alt, ro: u.alt },
	            caption: this.emptyLocalizedText(),
	            focal_x: u.focal_x,
	            focal_y: u.focal_y
	          }))
	        };
	      });
	    } else {
      let cursor = safeIndex;
      for (const u of uploads) {
        const createdKey = this.insertPageBlockAt(safePageKey, 'image', cursor, 'blank');
        if (!createdKey) break;
        this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) =>
          b.key === createdKey
	            ? {
	                ...b,
	                url: u.url,
	                focal_x: u.focal_x,
	                focal_y: u.focal_y,
	                alt: { ...b.alt, en: u.alt, ro: u.alt }
	              }
	            : b
	        );
	        cursor += 1;
	      }
	    }
	    this.toast.success(this.t('adminUi.content.mediaDrop.inserted', { count: uploads.length }));
	  }

	  private async insertHomeMediaFiles(index: number, files: File[]): Promise<void> {
	    const normalized = this.normalizeCmsImageFiles(files);
	    if (!normalized.length) return;
	    const uploads: Array<{ url: string; focal_x: number; focal_y: number; alt: string }> = [];
	    for (const file of normalized) {
	      const uploaded = await this.uploadCmsImageToKey('site.assets', file);
	      if (!uploaded) continue;
	      uploads.push({ ...uploaded, alt: this.filenameToAltText(file.name) });
	    }
	    if (!uploads.length) return;

	    const safeIndex = Math.max(0, Math.min(index, this.homeBlocks.length));
	    if (uploads.length === 1) {
	      const createdKey = this.insertHomeBlockAt('image', safeIndex, 'blank');
	      const u = uploads[0];
	      this.homeBlocks = this.homeBlocks.map((b) =>
	        b.key === createdKey
	          ? {
	              ...b,
	              url: u.url,
	              focal_x: u.focal_x,
	              focal_y: u.focal_y,
	              alt: { ...b.alt, en: u.alt, ro: u.alt }
	            }
	          : b
	      );
	    } else {
	      const createdKey = this.insertHomeBlockAt('gallery', safeIndex, 'blank');
	      this.homeBlocks = this.homeBlocks.map((b) => {
	        if (b.key !== createdKey || b.type !== 'gallery') return b;
	        return {
	          ...b,
	          images: uploads.map((u) => ({
	            url: u.url,
	            alt: { en: u.alt, ro: u.alt },
	            caption: this.emptyLocalizedText(),
	            focal_x: u.focal_x,
	            focal_y: u.focal_y
	          }))
	        };
	      });
	    }
	    this.toast.success(this.t('adminUi.content.mediaDrop.inserted', { count: uploads.length }));
	  }

  setPageImageBlockUrl(pageKey: PageBuilderKey, blockKey: string, asset: ContentImageAssetRead): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    const value = (asset?.url || '').trim();
    if (!value) return;
    const focalX = this.toFocalValue(asset.focal_x);
    const focalY = this.toFocalValue(asset.focal_y);
    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) =>
      b.key === blockKey ? { ...b, url: value, focal_x: focalX, focal_y: focalY } : b
    );
    this.toast.success(this.t('adminUi.site.assets.library.success.selected'));
  }

  setPageBannerSlideImage(pageKey: PageBuilderKey, blockKey: string, asset: ContentImageAssetRead): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    const value = (asset?.url || '').trim();
    if (!value) return;
    const focalX = this.toFocalValue(asset.focal_x);
    const focalY = this.toFocalValue(asset.focal_y);
    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'banner') return b;
      return { ...b, slide: { ...b.slide, image_url: value, focal_x: focalX, focal_y: focalY } };
    });
    this.toast.success(this.t('adminUi.site.assets.library.success.selected'));
  }

  addPageCarouselSlide(pageKey: PageBuilderKey, blockKey: string): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'carousel') return b;
      return { ...b, slides: [...(b.slides || []), this.emptySlideDraft()] };
    });
  }

  removePageCarouselSlide(pageKey: PageBuilderKey, blockKey: string, idx: number): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'carousel') return b;
      const next = [...(b.slides || [])];
      next.splice(idx, 1);
      return { ...b, slides: next.length ? next : [this.emptySlideDraft()] };
    });
  }

  movePageCarouselSlide(pageKey: PageBuilderKey, blockKey: string, idx: number, delta: number): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'carousel') return b;
      const slides = [...(b.slides || [])];
      const from = idx;
      const to = idx + delta;
      if (from < 0 || from >= slides.length) return b;
      if (to < 0 || to >= slides.length) return b;
      const [moved] = slides.splice(from, 1);
      slides.splice(to, 0, moved);
      return { ...b, slides };
    });
  }

  setPageCarouselSlideImage(pageKey: PageBuilderKey, blockKey: string, idx: number, asset: ContentImageAssetRead): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    const value = (asset?.url || '').trim();
    if (!value) return;
    const focalX = this.toFocalValue(asset.focal_x);
    const focalY = this.toFocalValue(asset.focal_y);
    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'carousel') return b;
      const slides = [...(b.slides || [])];
      const target = slides[idx];
      if (!target) return b;
      slides[idx] = { ...target, image_url: value, focal_x: focalX, focal_y: focalY };
      return { ...b, slides };
    });
    this.toast.success(this.t('adminUi.site.assets.library.success.selected'));
  }

  addPageGalleryImage(pageKey: PageBuilderKey, blockKey: string): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'gallery') return b;
      return {
        ...b,
        images: [
          ...b.images,
          {
            url: '',
            alt: this.emptyLocalizedText(),
            caption: this.emptyLocalizedText(),
            focal_x: 50,
            focal_y: 50
          }
        ]
      };
    });
  }

  addPageGalleryImageFromAsset(pageKey: PageBuilderKey, blockKey: string, asset: ContentImageAssetRead): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    const value = (asset?.url || '').trim();
    if (!value) return;
    const focalX = this.toFocalValue(asset.focal_x);
    const focalY = this.toFocalValue(asset.focal_y);
    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'gallery') return b;
      return {
        ...b,
        images: [
          ...b.images,
          {
            url: value,
            alt: this.emptyLocalizedText(),
            caption: this.emptyLocalizedText(),
            focal_x: focalX,
            focal_y: focalY
          }
        ]
      };
    });
    this.toast.success(this.t('adminUi.site.assets.library.success.selected'));
  }

  removePageGalleryImage(pageKey: PageBuilderKey, blockKey: string, idx: number): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'gallery') return b;
      const next = [...b.images];
      next.splice(idx, 1);
      return { ...b, images: next };
    });
  }

  addPageColumnsColumn(pageKey: PageBuilderKey, blockKey: string): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'columns') return b;
      const cols = [...(b.columns || [])];
      if (cols.length >= 3) return b;
      cols.push({ title: this.emptyLocalizedText(), body_markdown: this.emptyLocalizedText() });
      return { ...b, columns: cols };
    });
  }

  removePageColumnsColumn(pageKey: PageBuilderKey, blockKey: string, idx: number): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'columns') return b;
      const cols = [...(b.columns || [])];
      if (cols.length <= 2) return b;
      if (idx < 0 || idx >= cols.length) return b;
      cols.splice(idx, 1);
      return { ...b, columns: cols };
    });
  }

  private parseProductGridSlugs(raw: string): string[] {
    const unique: string[] = [];
    for (const part of (raw || '').split(/[,\n]/g)) {
      const slug = part.trim();
      if (!slug) continue;
      if (unique.includes(slug)) continue;
      unique.push(slug);
      if (unique.length >= 50) break;
    }
    return unique;
  }

  productGridSelectedSlugs(block: { product_grid_product_slugs: string }): string[] {
    return this.parseProductGridSlugs(block?.product_grid_product_slugs || '');
  }

  addProductGridProductSlug(block: { product_grid_product_slugs: string }, slug: string): void {
    const cleaned = (slug || '').trim();
    if (!cleaned) return;
    const slugs = this.parseProductGridSlugs(block?.product_grid_product_slugs || '');
    if (slugs.includes(cleaned)) return;
    slugs.push(cleaned);
    block.product_grid_product_slugs = slugs.join('\n');
  }

  removeProductGridProductSlug(block: { product_grid_product_slugs: string }, slug: string): void {
    const cleaned = (slug || '').trim();
    if (!cleaned) return;
    const slugs = this.parseProductGridSlugs(block?.product_grid_product_slugs || '');
    const next = slugs.filter((s) => s !== cleaned);
    block.product_grid_product_slugs = next.join('\n');
  }

  queueProductGridProductSearch(blockKey: string, query: string): void {
    this.productGridProductSearchQuery[blockKey] = query;

    const trimmed = (query || '').trim();
    if (!trimmed) {
      this.productGridProductSearchResults[blockKey] = [];
      this.productGridProductSearchError[blockKey] = null;
      this.productGridProductSearchLoading[blockKey] = false;
      const existing = this.productGridProductSearchTimers[blockKey];
      if (existing && typeof window !== 'undefined') {
        window.clearTimeout(existing);
      }
      delete this.productGridProductSearchTimers[blockKey];
      return;
    }

    if (typeof window === 'undefined') return;
    const existing = this.productGridProductSearchTimers[blockKey];
    if (existing) window.clearTimeout(existing);
    this.productGridProductSearchTimers[blockKey] = window.setTimeout(() => {
      this.searchProductGridProducts(blockKey);
    }, 250);
  }

  searchProductGridProducts(blockKey: string): void {
    const query = (this.productGridProductSearchQuery[blockKey] || '').trim();
    if (!query) {
      this.productGridProductSearchResults[blockKey] = [];
      this.productGridProductSearchError[blockKey] = null;
      this.productGridProductSearchLoading[blockKey] = false;
      return;
    }

    this.productGridProductSearchLoading[blockKey] = true;
    this.productGridProductSearchError[blockKey] = null;
    this.adminProducts.search({ q: query, limit: 8, page: 1 }).subscribe({
      next: (resp) => {
        this.productGridProductSearchResults[blockKey] = resp?.items || [];
        this.productGridProductSearchLoading[blockKey] = false;
      },
      error: () => {
        this.productGridProductSearchResults[blockKey] = [];
        this.productGridProductSearchLoading[blockKey] = false;
        this.productGridProductSearchError[blockKey] = this.t('adminUi.home.sections.errors.searchProducts');
      }
    });
  }

  addPageFaqItem(pageKey: PageBuilderKey, blockKey: string): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'faq') return b;
      const items = [...(b.faq_items || [])];
      if (items.length >= 20) return b;
      items.push({ question: this.emptyLocalizedText(), answer_markdown: this.emptyLocalizedText() });
      return { ...b, faq_items: items };
    });
  }

  removePageFaqItem(pageKey: PageBuilderKey, blockKey: string, idx: number): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'faq') return b;
      const items = [...(b.faq_items || [])];
      if (items.length <= 1) return b;
      if (idx < 0 || idx >= items.length) return b;
      items.splice(idx, 1);
      return { ...b, faq_items: items };
    });
  }

  addPageTestimonial(pageKey: PageBuilderKey, blockKey: string): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'testimonials') return b;
      const items = [...(b.testimonials || [])];
      if (items.length >= 12) return b;
      items.push({ quote_markdown: this.emptyLocalizedText(), author: this.emptyLocalizedText(), role: this.emptyLocalizedText() });
      return { ...b, testimonials: items };
    });
  }

  removePageTestimonial(pageKey: PageBuilderKey, blockKey: string, idx: number): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    this.pageBlocks[safePageKey] = (this.pageBlocks[safePageKey] || []).map((b) => {
      if (b.key !== blockKey || b.type !== 'testimonials') return b;
      const items = [...(b.testimonials || [])];
      if (items.length <= 1) return b;
      if (idx < 0 || idx >= items.length) return b;
      items.splice(idx, 1);
      return { ...b, testimonials: items };
    });
  }

  private buildPageBlocksMeta(pageKey: PageBuilderKey): Record<string, unknown> {
    const blocks = (this.pageBlocks[pageKey] || []).map((block) => this.buildPageBlockMeta(block));

    const meta = { ...(this.pageBlocksMeta[pageKey] || {}), version: 2, blocks } as Record<string, unknown>;
    if (this.pageKeySupportsRequiresAuth(pageKey) && this.pageBlocksRequiresAuth[pageKey]) {
      meta['requires_auth'] = true;
    } else {
      delete meta['requires_auth'];
    }
    return meta;
  }

  private buildPageBlockMeta(block: PageBlockDraft): Record<string, unknown> {
    const base: Record<string, unknown> = { key: block.key, type: block.type, enabled: block.enabled };
    base['title'] = block.title;
    base['layout'] = block.layout || this.defaultCmsBlockLayout();
    this.pageBlockMetaWriter(block.type)(base, block);
    return base;
  }

  private pageBlockMetaWriter(type: PageBlockType): (base: Record<string, unknown>, block: PageBlockDraft) => void {
    const writers: Record<PageBlockType, (base: Record<string, unknown>, block: PageBlockDraft) => void> = {
      text: (base, block) => this.writePageTextMeta(base, block),
      columns: (base, block) => this.writePageColumnsMeta(base, block),
      cta: (base, block) => this.writePageCtaMeta(base, block),
      faq: (base, block) => this.writePageFaqMeta(base, block),
      testimonials: (base, block) => this.writePageTestimonialsMeta(base, block),
      product_grid: (base, block) => this.writePageProductGridMeta(base, block),
      form: (base, block) => this.writePageFormMeta(base, block),
      image: (base, block) => this.writePageImageMeta(base, block),
      gallery: (base, block) => this.writePageGalleryMeta(base, block),
      banner: (base, block) => this.writePageBannerMeta(base, block),
      carousel: (base, block) => this.writePageCarouselMeta(base, block)
    };
    return writers[type];
  }

  private writePageTextMeta(base: Record<string, unknown>, block: PageBlockDraft): void {
    base['body_markdown'] = block.body_markdown;
  }

  private writePageColumnsMeta(base: Record<string, unknown>, block: PageBlockDraft): void {
    base['columns'] = (block.columns || []).slice(0, 3).map((col) => ({ title: col.title, body_markdown: col.body_markdown }));
    base['columns_breakpoint'] = block.columns_breakpoint;
  }

  private writePageCtaMeta(base: Record<string, unknown>, block: PageBlockDraft): void {
    base['body_markdown'] = block.body_markdown;
    base['cta_label'] = block.cta_label;
    base['cta_url'] = block.cta_url;
    base['cta_new_tab'] = Boolean(block.cta_new_tab);
  }

  private writePageFaqMeta(base: Record<string, unknown>, block: PageBlockDraft): void {
    base['items'] = (block.faq_items || []).slice(0, 20).map((item) => ({ question: item.question, answer_markdown: item.answer_markdown }));
  }

  private writePageTestimonialsMeta(base: Record<string, unknown>, block: PageBlockDraft): void {
    base['items'] = (block.testimonials || []).slice(0, 12).map((item) => ({
      quote_markdown: item.quote_markdown,
      author: item.author,
      role: item.role
    }));
  }

  private writePageProductGridMeta(base: Record<string, unknown>, block: PageBlockDraft): void {
    base['source'] = block.product_grid_source;
    const desiredLimit = Number(block.product_grid_limit || 6);
    base['limit'] = Math.max(1, Math.min(24, Number.isFinite(desiredLimit) ? Math.trunc(desiredLimit) : 6));

    if (block.product_grid_source === 'category') {
      const categorySlug = (block.product_grid_category_slug || '').trim();
      if (categorySlug) base['category_slug'] = categorySlug;
      return;
    }

    if (block.product_grid_source === 'collection') {
      const collectionSlug = (block.product_grid_collection_slug || '').trim();
      if (collectionSlug) base['collection_slug'] = collectionSlug;
      return;
    }

    const uniqueSlugs = this.uniqueProductGridSlugs(block.product_grid_product_slugs || '');
    if (uniqueSlugs.length) base['product_slugs'] = uniqueSlugs;
  }

  private uniqueProductGridSlugs(rawValue: string): string[] {
    const unique: string[] = [];
    for (const raw of rawValue.split(/[,\n]/g)) {
      const slug = raw.trim();
      if (!slug || unique.includes(slug)) continue;
      unique.push(slug);
      if (unique.length >= 50) break;
    }
    return unique;
  }

  private writePageFormMeta(base: Record<string, unknown>, block: PageBlockDraft): void {
    base['form_type'] = block.form_type;
    if (block.form_type === 'contact') base['topic'] = block.form_topic;
  }

  private writePageImageMeta(base: Record<string, unknown>, block: PageBlockDraft): void {
    base['url'] = block.url;
    base['link_url'] = block.link_url;
    base['alt'] = block.alt;
    base['caption'] = block.caption;
    base['focal_x'] = this.toFocalValue(block.focal_x);
    base['focal_y'] = this.toFocalValue(block.focal_y);
  }

  private writePageGalleryMeta(base: Record<string, unknown>, block: PageBlockDraft): void {
    base['images'] = (block.images || []).map((img) => ({
      url: img.url,
      alt: img.alt,
      caption: img.caption,
      focal_x: this.toFocalValue(img.focal_x),
      focal_y: this.toFocalValue(img.focal_y)
    }));
  }

  private writePageBannerMeta(base: Record<string, unknown>, block: PageBlockDraft): void {
    base['slide'] = this.serializeSlideDraft(block.slide);
  }

  private writePageCarouselMeta(base: Record<string, unknown>, block: PageBlockDraft): void {
    base['slides'] = (block.slides || []).map((slide) => this.serializeSlideDraft(slide));
    base['settings'] = block.settings;
  }

  private pagePublishChecklistBlockLabel(block: PageBlockDraft, idx: number): string {
    const title = (block.title?.[this.infoLang] || block.title?.en || block.title?.ro || '').trim();
    const base = title ? title : this.pageBlockLabel(block);
    return `${idx + 1}. ${base}`;
  }

  private computePagePublishChecklistLocal(pageKey: PageBuilderKey): Pick<CmsPublishChecklistResult, 'missingTranslations' | 'missingAlt' | 'emptySections'> {
    const missingTranslations: UiLang[] = [];
    if (this.pageBlocksNeedsTranslationEn[pageKey]) missingTranslations.push('en');
    if (this.pageBlocksNeedsTranslationRo[pageKey]) missingTranslations.push('ro');

    const missingAlt: string[] = [];
    const emptySections: string[] = [];
    const blocks = this.pageBlocks[pageKey] || [];
    const enabledBlocks = blocks.filter((b) => Boolean(b?.enabled));

    if (!enabledBlocks.length) {
      emptySections.push(this.t('adminUi.content.publishChecklist.emptyAllDisabled'));
    }

    enabledBlocks.forEach((block, idx) => this.appendPagePublishChecklistIssues(block, idx, missingAlt, emptySections));

    return { missingTranslations, missingAlt, emptySections };
  }

  private appendPagePublishChecklistIssues(
    block: PageBlockDraft,
    idx: number,
    missingAlt: string[],
    emptySections: string[]
  ): void {
    const label = this.pagePublishChecklistBlockLabel(block, idx);
    this.pagePublishChecklistWriter(block.type)(block, label, missingAlt, emptySections);
  }

  private pagePublishChecklistWriter(
    type: PageBlockType
  ): (block: PageBlockDraft, label: string, missingAlt: string[], emptySections: string[]) => void {
    const writers: Record<
      PageBlockType,
      (block: PageBlockDraft, label: string, missingAlt: string[], emptySections: string[]) => void
    > = {
      text: (block, label, _missingAlt, emptySections) => this.appendTextChecklistIssues(block, label, emptySections),
      columns: (block, label, _missingAlt, emptySections) => this.appendColumnsChecklistIssues(block, label, emptySections),
      cta: (block, label, _missingAlt, emptySections) => this.appendCtaChecklistIssues(block, label, emptySections),
      faq: (block, label, _missingAlt, emptySections) => this.appendFaqChecklistIssues(block, label, emptySections),
      testimonials: (block, label, _missingAlt, emptySections) => this.appendTestimonialsChecklistIssues(block, label, emptySections),
      product_grid: (block, label, _missingAlt, emptySections) => this.appendProductGridChecklistIssues(block, label, emptySections),
      form: () => undefined,
      image: (block, label, missingAlt, emptySections) => this.appendImageChecklistIssues(block, label, missingAlt, emptySections),
      gallery: (block, label, missingAlt, emptySections) => this.appendGalleryChecklistIssues(block, label, missingAlt, emptySections),
      banner: (block, label, missingAlt, emptySections) => this.appendBannerChecklistIssues(block, label, missingAlt, emptySections),
      carousel: (block, label, missingAlt, emptySections) => this.appendCarouselChecklistIssues(block, label, missingAlt, emptySections)
    };
    return writers[type];
  }

  private appendTextChecklistIssues(block: PageBlockDraft, label: string, emptySections: string[]): void {
    if (this.hasAnyLocalizedText([block.body_markdown])) return;
    emptySections.push(label);
  }

  private appendColumnsChecklistIssues(block: PageBlockDraft, label: string, emptySections: string[]): void {
    const hasAny = (block.columns || []).some((col) => this.hasAnyLocalizedText([col?.title, col?.body_markdown]));
    if (hasAny) return;
    emptySections.push(label);
  }

  private appendCtaChecklistIssues(block: PageBlockDraft, label: string, emptySections: string[]): void {
    const hasAnyText = this.hasAnyLocalizedText([block.title, block.body_markdown, block.cta_label]);
    if (hasAnyText || this.hasTrimmedText(block.cta_url)) return;
    emptySections.push(label);
  }

  private appendFaqChecklistIssues(block: PageBlockDraft, label: string, emptySections: string[]): void {
    const hasAny = (block.faq_items || []).some((item) => this.hasAnyLocalizedText([item?.question, item?.answer_markdown]));
    if (hasAny) return;
    emptySections.push(label);
  }

  private appendTestimonialsChecklistIssues(block: PageBlockDraft, label: string, emptySections: string[]): void {
    const hasAny = (block.testimonials || []).some((item) => this.hasAnyLocalizedText([item?.quote_markdown, item?.author, item?.role]));
    if (hasAny) return;
    emptySections.push(label);
  }

  private appendProductGridChecklistIssues(block: PageBlockDraft, label: string, emptySections: string[]): void {
    if (!this.isProductGridBlockEmpty(block)) return;
    emptySections.push(label);
  }

  private isProductGridBlockEmpty(block: PageBlockDraft): boolean {
    if (block.product_grid_source === 'category') {
      return !this.hasTrimmedText(block.product_grid_category_slug);
    }
    if (block.product_grid_source === 'collection') {
      return !this.hasTrimmedText(block.product_grid_collection_slug);
    }
    return !(block.product_grid_product_slugs || '').split(/[,\n]/g).some((raw) => this.hasTrimmedText(raw));
  }

  private appendImageChecklistIssues(
    block: PageBlockDraft,
    label: string,
    missingAlt: string[],
    emptySections: string[]
  ): void {
    if (!this.hasTrimmedText(block.url)) {
      emptySections.push(label);
      return;
    }
    this.appendMissingAltLabels(missingAlt, label, block.alt);
  }

  private appendGalleryChecklistIssues(
    block: PageBlockDraft,
    label: string,
    missingAlt: string[],
    emptySections: string[]
  ): void {
    const withUrls = (block.images || []).filter((img) => this.hasTrimmedText(img?.url));
    if (!withUrls.length) {
      emptySections.push(label);
      return;
    }
    withUrls.forEach((img, imgIdx) => {
      const imgLabel = `${label} · ${this.t('adminUi.content.publishChecklist.imageLabel', { index: imgIdx + 1 })}`;
      this.appendMissingAltLabels(missingAlt, imgLabel, img.alt);
    });
  }

  private appendBannerChecklistIssues(
    block: PageBlockDraft,
    label: string,
    missingAlt: string[],
    emptySections: string[]
  ): void {
    if (!this.hasTrimmedText(block.slide?.image_url)) {
      emptySections.push(label);
      return;
    }
    this.appendMissingAltLabels(missingAlt, label, block.slide?.alt);
  }

  private appendCarouselChecklistIssues(
    block: PageBlockDraft,
    label: string,
    missingAlt: string[],
    emptySections: string[]
  ): void {
    const withUrls = (block.slides || []).filter((slide) => this.hasTrimmedText(slide?.image_url));
    if (!withUrls.length) {
      emptySections.push(label);
      return;
    }
    withUrls.forEach((slide, slideIdx) => {
      const slideLabel = `${label} · ${this.t('adminUi.content.publishChecklist.slideLabel', { index: slideIdx + 1 })}`;
      this.appendMissingAltLabels(missingAlt, slideLabel, slide.alt);
    });
  }

  private appendMissingAltLabels(missingAlt: string[], label: string, value: LocalizedText | null | undefined): void {
    if (!this.hasTrimmedText(value?.en)) missingAlt.push(`${label} (EN)`);
    if (!this.hasTrimmedText(value?.ro)) missingAlt.push(`${label} (RO)`);
  }

  private hasAnyLocalizedText(values: Array<LocalizedText | null | undefined>): boolean {
    return values.some((value) => this.hasTrimmedText(value?.en) || this.hasTrimmedText(value?.ro));
  }

  private hasTrimmedText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  openPagePublishChecklist(pageKey: PageBuilderKey): void {
    this.pagePublishChecklistOpen = true;
    this.pagePublishChecklistKey = pageKey;
    this.pagePublishChecklistLoading = true;
    this.pagePublishChecklistError = null;
    const local = this.computePagePublishChecklistLocal(pageKey);
    this.pagePublishChecklistResult = { ...local, linkIssues: [] };

    const meta = this.buildPageBlocksMeta(pageKey);
    this.admin.linkCheckContentPreview({ key: pageKey, meta, body_markdown: '', images: [] }).subscribe({
      next: (resp) => {
        this.pagePublishChecklistLoading = false;
        const current = this.pagePublishChecklistResult;
        if (!current) return;
        this.pagePublishChecklistResult = { ...current, linkIssues: resp?.issues || [] };
      },
      error: (err) => {
        this.pagePublishChecklistLoading = false;
        this.pagePublishChecklistError = err?.error?.detail || this.t('adminUi.content.publishChecklist.errors.linkCheck');
      }
    });
  }

  closePagePublishChecklist(): void {
    this.pagePublishChecklistOpen = false;
    this.pagePublishChecklistLoading = false;
    this.pagePublishChecklistError = null;
    this.pagePublishChecklistKey = null;
    this.pagePublishChecklistResult = null;
  }

  pagePublishChecklistHasIssues(): boolean {
    const checklist = this.pagePublishChecklistResult;
    if (!checklist) return false;
    return Boolean(
      checklist.missingTranslations.length ||
        checklist.missingAlt.length ||
        checklist.emptySections.length ||
        checklist.linkIssues.length
    );
  }

  confirmPagePublishChecklist(): void {
    const key = this.pagePublishChecklistKey;
    if (!key) return;
    this.closePagePublishChecklist();
    this.savePageBlocks(key, { bypassChecklist: true });
  }

  savePageBlocks(pageKey: PageBuilderKey, opts?: { bypassChecklist?: boolean }): void {
    const safePageKey = this.safePageRecordKey(pageKey);
    this.pageBlocksMessage[safePageKey] = null;
    this.pageBlocksError[safePageKey] = null;

    const status: ContentStatusUi = this.pageBlocksStatus[safePageKey] || 'draft';
    if (!opts?.bypassChecklist && status === 'published') {
      this.openPagePublishChecklist(safePageKey);
      return;
    }

    const meta = this.buildPageBlocksMeta(safePageKey);
    const published_at =
      status === 'published'
        ? this.pageBlocksPublishedAt[safePageKey]
          ? new Date(this.pageBlocksPublishedAt[safePageKey]).toISOString()
          : null
        : null;
    const published_until =
      status === 'published'
        ? this.pageBlocksPublishedUntil[safePageKey]
          ? new Date(this.pageBlocksPublishedUntil[safePageKey]).toISOString()
          : null
        : null;
    const payload: Record<string, unknown> = { meta, status, published_at, published_until, lang: this.infoLang };

    const ok = this.t('adminUi.site.pages.builder.success.save');
    const errMsg = this.t('adminUi.site.pages.builder.errors.save');

    const reload = () => this.loadPageBlocks(safePageKey);

    this.admin.updateContentBlock(safePageKey, this.withExpectedVersion(safePageKey, payload)).subscribe({
      next: (block) => {
        this.rememberContentVersion(safePageKey, block);
        this.pageBlocksNeedsTranslationEn[safePageKey] = Boolean(block?.needs_translation_en);
        this.pageBlocksNeedsTranslationRo[safePageKey] = Boolean(block?.needs_translation_ro);
        this.pageBlocksStatus[safePageKey] = this.normalizeContentStatus(block?.status);
        this.pageBlocksPublishedAt[safePageKey] = block?.published_at ? this.toLocalDateTime(block.published_at) : '';
        this.pageBlocksPublishedUntil[safePageKey] = block?.published_until
          ? this.toLocalDateTime(block.published_until)
          : '';
        this.pageBlocksMeta[safePageKey] = this.toRecord(block?.meta);
        this.pageBlocksRequiresAuth[safePageKey] = Boolean(this.pageBlocksMeta[safePageKey]?.['requires_auth']);
        this.pageBlocksMessage[safePageKey] = ok;
        this.pageBlocksError[safePageKey] = null;
        this.ensurePageDraft(safePageKey).markServerSaved(this.currentPageDraftState(safePageKey), true);
        const slug = this.pagePreviewSlug(safePageKey);
        if (slug && this.pagePreviewForSlug === slug) this.refreshPagePreview();
      },
      error: (err) => {
        if (this.handleContentConflict(err, safePageKey, reload)) {
          this.pageBlocksError[safePageKey] = errMsg;
          this.pageBlocksMessage[safePageKey] = null;
          return;
        }
        if (err?.status === 404) {
          const createPayload = {
            title:
              this.contentPages.find((p) => p.key === safePageKey)?.title ||
              cmsGlobalSectionDefaultTitle(safePageKey) ||
              safePageKey,
            body_markdown: 'Page builder',
            status,
            lang: this.infoLang,
            published_at,
            published_until,
            meta
          };
          this.admin.createContent(safePageKey, createPayload).subscribe({
            next: (created) => {
              this.rememberContentVersion(safePageKey, created);
              this.pageBlocksNeedsTranslationEn[safePageKey] = Boolean(created?.needs_translation_en);
              this.pageBlocksNeedsTranslationRo[safePageKey] = Boolean(created?.needs_translation_ro);
              this.pageBlocksStatus[safePageKey] = this.normalizeContentStatus(created?.status);
              this.pageBlocksPublishedAt[safePageKey] = created?.published_at
                ? this.toLocalDateTime(created.published_at)
                : '';
              this.pageBlocksPublishedUntil[safePageKey] = created?.published_until
                ? this.toLocalDateTime(created.published_until)
                : '';
              this.pageBlocksMeta[safePageKey] = this.toRecord(created?.meta);
              this.pageBlocksRequiresAuth[safePageKey] = Boolean(this.pageBlocksMeta[safePageKey]?.['requires_auth']);
              this.pageBlocksMessage[safePageKey] = ok;
              this.pageBlocksError[safePageKey] = null;
              this.ensurePageDraft(safePageKey).markServerSaved(this.currentPageDraftState(safePageKey), true);
              const slug = this.pagePreviewSlug(safePageKey);
              if (slug && this.pagePreviewForSlug === slug) this.refreshPagePreview();
            },
            error: () => {
              this.pageBlocksError[safePageKey] = errMsg;
              this.pageBlocksMessage[safePageKey] = null;
            }
          });
          return;
        }
        this.pageBlocksError[safePageKey] = errMsg;
        this.pageBlocksMessage[safePageKey] = null;
      }
    });
  }

  // Homepage sections (page builder blocks)
  selectHomeBlocksLang(lang: UiLang): void {
    this.homeBlocksLang = lang;
  }

  private safePageRecordKey(pageKey: PageBuilderKey): PageBuilderKey {
    const value = String(pageKey || '').trim();
    if (!/^page\.[a-z0-9._-]+$/i.test(value)) {
      return 'page.about';
    }
    const normalized = value.toLowerCase();
    if (
      normalized === 'page.__proto__' ||
      normalized.endsWith('.__proto__') ||
      normalized.endsWith('.prototype') ||
      normalized.endsWith('.constructor')
    ) {
      return 'page.about';
    }
    return value as PageBuilderKey;
  }

  private normalizeContentStatus(value: unknown): ContentStatusUi {
    if (value === 'published') return 'published';
    if (value === 'review') return 'review';
    return 'draft';
  }

  private safeRecordKey(key: string, fallback = 'unknown'): string {
    const value = String(key || '').trim();
    if (!/^[a-z0-9._:-]+$/i.test(value)) {
      return fallback;
    }
    const normalized = value.toLowerCase();
    if (
      normalized === '__proto__' ||
      normalized === 'prototype' ||
      normalized === 'constructor' ||
      normalized.endsWith('.__proto__') ||
      normalized.endsWith('.prototype') ||
      normalized.endsWith('.constructor')
    ) {
      return fallback;
    }
    return value;
  }

  private setPageRecordValue<T>(record: Record<string, T>, pageKey: PageBuilderKey, value: T): void {
    Reflect.set(record, this.safePageRecordKey(pageKey), value);
  }

  private setRecordValue<T>(record: Record<string, T>, key: string, value: T, fallback = 'unknown'): void {
    Reflect.set(record, this.safeRecordKey(key, fallback), value);
  }

  private deleteRecordValue(record: Record<string, unknown>, key: string, fallback = 'unknown'): void {
    Reflect.deleteProperty(record, this.safeRecordKey(key, fallback));
  }

  private emptyLocalizedText(): LocalizedText {
    return { en: '', ro: '' };
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private toLocalizedText(value: unknown): LocalizedText {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return { en: trimmed, ro: trimmed };
    }
    if (!value || typeof value !== 'object') {
      return this.emptyLocalizedText();
    }
    const record = value as Record<string, unknown>;
    return {
      en: typeof record['en'] === 'string' ? String(record['en']).trim() : '',
      ro: typeof record['ro'] === 'string' ? String(record['ro']).trim() : ''
    };
  }

  private toFocalValue(value: unknown, fallback = 50): number {
    const raw = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(raw)) return fallback;
    return Math.max(0, Math.min(100, Math.round(raw)));
  }

  private toBooleanValue(value: unknown, fallback = false): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
      if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
    }
    return fallback;
  }

  private defaultCmsBlockLayout(): CmsBlockLayout {
    return { spacing: 'none', background: 'none', align: 'left', max_width: 'full' };
  }

  private toCmsBlockLayout(value: unknown): CmsBlockLayout {
    const rec = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const spacingRaw = typeof rec['spacing'] === 'string' ? String(rec['spacing']).trim() : '';
    const backgroundRaw = typeof rec['background'] === 'string' ? String(rec['background']).trim() : '';
    const alignRaw = typeof rec['align'] === 'string' ? String(rec['align']).trim() : '';
    const maxWidthValue = rec['max_width'] ?? rec['maxWidth'];
    const maxWidthRaw = typeof maxWidthValue === 'string' ? String(maxWidthValue).trim() : '';

    const spacing: CmsBlockLayoutSpacing =
      spacingRaw === 'sm' || spacingRaw === 'md' || spacingRaw === 'lg' || spacingRaw === 'none'
        ? (spacingRaw as CmsBlockLayoutSpacing)
        : 'none';
    const background: CmsBlockLayoutBackground =
      backgroundRaw === 'muted' || backgroundRaw === 'accent' || backgroundRaw === 'none'
        ? (backgroundRaw as CmsBlockLayoutBackground)
        : 'none';
    const align: CmsBlockLayoutAlign = alignRaw === 'center' ? 'center' : 'left';
    const max_width: CmsBlockLayoutMaxWidth =
      maxWidthRaw === 'narrow' || maxWidthRaw === 'prose' || maxWidthRaw === 'wide' || maxWidthRaw === 'full'
        ? (maxWidthRaw as CmsBlockLayoutMaxWidth)
        : 'full';

    return { spacing, background, align, max_width };
  }

  focalPosition(focalX: unknown, focalY: unknown): string {
    return `${this.toFocalValue(focalX)}% ${this.toFocalValue(focalY)}%`;
  }

  private emptySlideDraft(): SlideDraft {
    return {
      image_url: '',
      alt: this.emptyLocalizedText(),
      headline: this.emptyLocalizedText(),
      subheadline: this.emptyLocalizedText(),
      cta_label: this.emptyLocalizedText(),
      cta_url: '',
      variant: 'split',
      size: 'M',
      text_style: 'dark',
      focal_x: 50,
      focal_y: 50
    };
  }

  private toSlideDraft(value: unknown): SlideDraft {
    if (!value || typeof value !== 'object') return this.emptySlideDraft();
    const rec = value as Record<string, unknown>;
    const draft = this.emptySlideDraft();
    draft.image_url =
      typeof rec['image_url'] === 'string'
        ? String(rec['image_url']).trim()
        : typeof rec['image'] === 'string'
          ? String(rec['image']).trim()
          : draft.image_url;
    draft.alt = this.toLocalizedText(rec['alt']);
    draft.headline = this.toLocalizedText(rec['headline']);
    draft.subheadline = this.toLocalizedText(rec['subheadline']);
    draft.cta_label = this.toLocalizedText(rec['cta_label']);
    draft.cta_url = typeof rec['cta_url'] === 'string' ? String(rec['cta_url']).trim() : '';
    draft.variant = rec['variant'] === 'full' ? 'full' : 'split';
    draft.size = rec['size'] === 'S' || rec['size'] === 'L' ? (rec['size'] as any) : 'M';
    draft.text_style = rec['text_style'] === 'light' ? 'light' : 'dark';
    draft.focal_x = this.toFocalValue(rec['focal_x']);
    draft.focal_y = this.toFocalValue(rec['focal_y']);
    return draft;
  }

  private toCarouselSettingsDraft(value: unknown): CarouselSettingsDraft {
    const rec = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const base = this.defaultCarouselSettings();
    base.autoplay = rec['autoplay'] === true;
    const interval = typeof rec['interval_ms'] === 'number' ? rec['interval_ms'] : Number(rec['interval_ms']);
    base.interval_ms = Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : base.interval_ms;
    base.show_dots = rec['show_dots'] === false ? false : true;
    base.show_arrows = rec['show_arrows'] === false ? false : true;
    base.pause_on_hover = rec['pause_on_hover'] === false ? false : true;
    return base;
  }

  private serializeSlideDraft(slide: SlideDraft): Record<string, unknown> {
    return {
      image_url: (slide.image_url || '').trim(),
      alt: slide.alt,
      headline: slide.headline,
      subheadline: slide.subheadline,
      cta_label: slide.cta_label,
      cta_url: (slide.cta_url || '').trim(),
      variant: slide.variant,
      size: slide.size,
      text_style: slide.text_style,
      focal_x: this.toFocalValue(slide.focal_x),
      focal_y: this.toFocalValue(slide.focal_y)
    };
  }

  private defaultCarouselSettings(): CarouselSettingsDraft {
    return {
      autoplay: false,
      interval_ms: 5000,
      show_dots: true,
      show_arrows: true,
      pause_on_hover: true
    };
  }

  toPreviewSlide(slide: SlideDraft, lang: UiLang = this.homeBlocksLang): any {
    const other: UiLang = lang === 'ro' ? 'en' : 'ro';
    const pick = (text: LocalizedText | null | undefined): string => {
      if (!text) return '';
      const preferred = (text[lang] || '').trim();
      if (preferred) return preferred;
      return (text[other] || '').trim();
    };
    return {
      image_url: (slide.image_url || '').trim(),
      alt: pick(slide.alt) || null,
      headline: pick(slide.headline) || null,
      subheadline: pick(slide.subheadline) || null,
      cta_label: pick(slide.cta_label) || null,
      cta_url: (slide.cta_url || '').trim() || null,
      variant: slide.variant,
      size: slide.size,
      text_style: slide.text_style,
      focal_x: this.toFocalValue(slide.focal_x),
      focal_y: this.toFocalValue(slide.focal_y)
    };
  }

  toPreviewSlides(slides: SlideDraft[], lang: UiLang = this.homeBlocksLang): any[] {
    return (slides || []).map((s) => this.toPreviewSlide(s, lang));
  }

  private isHomeSectionId(value: unknown): value is HomeSectionId {
    return (
      value === 'featured_products' ||
      value === 'sale_products' ||
      value === 'new_arrivals' ||
      value === 'featured_collections' ||
      value === 'story' ||
      value === 'recently_viewed' ||
      value === 'why'
    );
  }

  private normalizeHomeSectionId(value: unknown): HomeSectionId | null {
    if (this.isHomeSectionId(value)) return value;
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    if (!raw) return null;
    const key = raw
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    if (this.isHomeSectionId(key)) return key;
    if (key === 'collections') return 'featured_collections';
    if (key === 'featured') return 'featured_products';
    if (key === 'bestsellers') return 'featured_products';
    if (key === 'sale' || key === 'sales') return 'sale_products';
    if (key === 'new') return 'new_arrivals';
    if (key === 'recent') return 'recently_viewed';
    if (key === 'recentlyviewed') return 'recently_viewed';
    return null;
  }

  private defaultHomeSections(): { id: HomeSectionId; enabled: boolean }[] {
    return [
      { id: 'featured_products', enabled: true },
      { id: 'sale_products', enabled: false },
      { id: 'new_arrivals', enabled: true },
      { id: 'featured_collections', enabled: true },
      { id: 'story', enabled: true },
      { id: 'recently_viewed', enabled: true },
      { id: 'why', enabled: true }
    ];
  }

  private makeHomeBlockDraft(key: string, type: HomeBlockType, enabled: boolean): HomeBlockDraft {
    return {
      key,
      type,
      enabled,
      title: this.emptyLocalizedText(),
      body_markdown: this.emptyLocalizedText(),
      columns: [
        { title: this.emptyLocalizedText(), body_markdown: this.emptyLocalizedText() },
        { title: this.emptyLocalizedText(), body_markdown: this.emptyLocalizedText() }
      ],
      columns_breakpoint: 'md',
      cta_label: this.emptyLocalizedText(),
      cta_url: '',
      cta_new_tab: false,
      faq_items: [{ question: this.emptyLocalizedText(), answer_markdown: this.emptyLocalizedText() }],
      testimonials: [{ quote_markdown: this.emptyLocalizedText(), author: this.emptyLocalizedText(), role: this.emptyLocalizedText() }],
      product_grid_source: 'category',
      product_grid_category_slug: '',
      product_grid_collection_slug: '',
      product_grid_product_slugs: '',
      product_grid_limit: 6,
      form_type: 'contact',
      form_topic: 'contact',
      url: '',
      link_url: '',
      focal_x: 50,
      focal_y: 50,
      alt: this.emptyLocalizedText(),
      caption: this.emptyLocalizedText(),
      images: [],
      slide: this.emptySlideDraft(),
      slides: [this.emptySlideDraft()],
      settings: this.defaultCarouselSettings()
    };
  }

  private ensureAllDefaultHomeBlocks(blocks: HomeBlockDraft[]): HomeBlockDraft[] {
    const out = [...blocks];
    const existing = new Set(out.filter((b) => this.isHomeSectionId(b.type)).map((b) => b.type as HomeSectionId));
    for (const { id, enabled } of this.defaultHomeSections()) {
      if (existing.has(id)) continue;
      out.push(this.makeHomeBlockDraft(id, id, enabled));
    }
    return out;
  }

  isCustomHomeBlock(block: HomeBlockDraft): boolean {
    return (
      block.type === 'text' ||
      block.type === 'columns' ||
      block.type === 'cta' ||
      block.type === 'faq' ||
      block.type === 'testimonials' ||
      block.type === 'product_grid' ||
      block.type === 'form' ||
      block.type === 'image' ||
      block.type === 'gallery' ||
      block.type === 'banner' ||
      block.type === 'carousel'
    );
  }

  homeBlockLabel(block: HomeBlockDraft): string {
    const key = `adminUi.home.sections.blocks.${block.type}`;
    const translated = this.t(key);
    return translated !== key ? translated : String(block.type);
  }

	  toggleHomeBlockEnabled(block: HomeBlockDraft, event: Event): void {
	    const target = event.target as HTMLInputElement | null;
	    const enabled = target?.checked !== false;
	    this.homeBlocks = this.homeBlocks.map((b) => (b.key === block.key ? { ...b, enabled } : b));
	  }

	  moveHomeBlock(blockKey: string, delta: number): void {
	    const current = [...this.homeBlocks];
	    const from = current.findIndex((b) => b.key === blockKey);
	    if (from === -1) return;
	    const to = from + delta;
	    if (to < 0 || to >= current.length) return;
	    const [moved] = current.splice(from, 1);
	    current.splice(to, 0, moved);
	    this.homeBlocks = current;
	    this.announceCms(
	      this.t('adminUi.content.reorder.moved', { label: this.homeBlockLabel(moved), pos: to + 1, count: current.length })
	    );
	  }

  setHomeInsertDragActive(active: boolean): void {
    this.homeInsertDragActive = active;
  }

  addHomeBlockFromLibrary(type: CmsBlockLibraryBlockType, template: CmsBlockLibraryTemplate): void {
    this.insertHomeBlockAt(type, this.homeBlocks.length, template);
  }

	  private insertHomeBlockAt(type: CmsBlockLibraryBlockType, index: number, template: CmsBlockLibraryTemplate): string {
	    const key = this.nextCustomBlockKey(type);
	    const draft = this.makeHomeBlockDraft(key, type, true);
	    if (template === 'starter') {
	      this.applyStarterTemplateToCustomBlock(type, draft);
	    }
	    const current = [...this.homeBlocks];
	    const safeIndex = Math.max(0, Math.min(index, current.length));
	    current.splice(safeIndex, 0, draft);
	    this.homeBlocks = current;
	    return key;
	  }

  onHomeBlockDragStart(key: string): void {
    this.homeInsertDragActive = true;
    this.draggingHomeBlockKey = key;
  }

  onHomeBlockDragEnd(): void {
    this.draggingHomeBlockKey = null;
    this.homeInsertDragActive = false;
  }

  onHomeBlockDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onHomeBlockDropZone(event: DragEvent, index: number): void {
    event.preventDefault();
    const current = [...this.homeBlocks];

    if (this.draggingHomeBlockKey) {
      const from = current.findIndex((b) => b.key === this.draggingHomeBlockKey);
      if (from === -1) {
        this.onHomeBlockDragEnd();
        return;
      }
      const safeIndex = Math.max(0, Math.min(index, current.length));
      const [moved] = current.splice(from, 1);
      const nextIndex = from < safeIndex ? safeIndex - 1 : safeIndex;
      current.splice(nextIndex, 0, moved);
      this.homeBlocks = current;
      this.onHomeBlockDragEnd();
      return;
    }

    const payload = this.readCmsBlockPayload(event);
    if (!payload || payload.scope !== 'home') {
      this.onHomeBlockDragEnd();
      return;
    }

    this.insertHomeBlockAt(payload.type, index, payload.template);
    this.homeInsertDragActive = false;
  }

	  onHomeBlockDrop(event: DragEvent, targetKey: string): void {
	    event.preventDefault();

	    const mediaFiles = this.extractCmsImageFiles(event);
	    if (mediaFiles.length) {
	      const to = this.homeBlocks.findIndex((b) => b.key === targetKey);
	      const safeIndex = to !== -1 ? to : this.homeBlocks.length;
	      void this.insertHomeMediaFiles(safeIndex, mediaFiles);
	      this.homeInsertDragActive = false;
	      return;
	    }

	    const payload = this.readCmsBlockPayload(event);
	    if (payload?.scope === 'home') {
	      const to = this.homeBlocks.findIndex((b) => b.key === targetKey);
	      if (to !== -1) {
	          this.insertHomeBlockAt(payload.type, to, payload.template);
      }
      this.homeInsertDragActive = false;
      return;
    }

    if (!this.draggingHomeBlockKey || this.draggingHomeBlockKey === targetKey) return;
    const current = [...this.homeBlocks];
    const from = current.findIndex((b) => b.key === this.draggingHomeBlockKey);
    const to = current.findIndex((b) => b.key === targetKey);
    if (from === -1 || to === -1) {
      this.onHomeBlockDragEnd();
      return;
    }
    const [moved] = current.splice(from, 1);
    const nextIndex = from < to ? to - 1 : to;
    current.splice(nextIndex, 0, moved);
    this.homeBlocks = current;
    this.onHomeBlockDragEnd();
  }

  private nextCustomBlockKey(type: string): string {
    const base = `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    let key = base;
    let i = 1;
    while (this.homeBlocks.some((b) => b.key === key)) {
      key = `${base}-${i}`;
      i += 1;
    }
    return key;
  }

  addHomeBlock(): void {
    this.insertHomeBlockAt(this.newHomeBlockType, this.homeBlocks.length, 'blank');
  }

  removeHomeBlock(key: string): void {
    const target = this.homeBlocks.find((b) => b.key === key);
    if (!target || !this.isCustomHomeBlock(target)) return;
    this.homeBlocks = this.homeBlocks.filter((b) => b.key !== key);
  }

  setImageBlockUrl(blockKey: string, asset: ContentImageAssetRead): void {
    const value = (asset?.url || '').trim();
    if (!value) return;
    const focalX = this.toFocalValue(asset.focal_x);
    const focalY = this.toFocalValue(asset.focal_y);
    this.homeBlocks = this.homeBlocks.map((b) => (b.key === blockKey ? { ...b, url: value, focal_x: focalX, focal_y: focalY } : b));
    this.toast.success(this.t('adminUi.site.assets.library.success.selected'));
  }

  addGalleryImage(blockKey: string): void {
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'gallery') return b;
      return {
        ...b,
        images: [
          ...b.images,
          {
            url: '',
            alt: this.emptyLocalizedText(),
            caption: this.emptyLocalizedText(),
            focal_x: 50,
            focal_y: 50
          }
        ]
      };
    });
  }

  addGalleryImageFromAsset(blockKey: string, asset: ContentImageAssetRead): void {
    const value = (asset?.url || '').trim();
    if (!value) return;
    const focalX = this.toFocalValue(asset.focal_x);
    const focalY = this.toFocalValue(asset.focal_y);
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'gallery') return b;
      return {
        ...b,
        images: [
          ...b.images,
          {
            url: value,
            alt: this.emptyLocalizedText(),
            caption: this.emptyLocalizedText(),
            focal_x: focalX,
            focal_y: focalY
          }
        ]
      };
    });
    this.toast.success(this.t('adminUi.site.assets.library.success.selected'));
  }

  removeGalleryImage(blockKey: string, idx: number): void {
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'gallery') return b;
      const next = [...b.images];
      next.splice(idx, 1);
      return { ...b, images: next };
    });
  }

  addHomeColumnsColumn(blockKey: string): void {
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'columns') return b;
      const cols = [...(b.columns || [])];
      if (cols.length >= 3) return b;
      cols.push({ title: this.emptyLocalizedText(), body_markdown: this.emptyLocalizedText() });
      return { ...b, columns: cols };
    });
  }

  removeHomeColumnsColumn(blockKey: string, idx: number): void {
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'columns') return b;
      const cols = [...(b.columns || [])];
      if (cols.length <= 2) return b;
      if (idx < 0 || idx >= cols.length) return b;
      cols.splice(idx, 1);
      return { ...b, columns: cols };
    });
  }

  addHomeFaqItem(blockKey: string): void {
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'faq') return b;
      const items = [...(b.faq_items || [])];
      if (items.length >= 20) return b;
      items.push({ question: this.emptyLocalizedText(), answer_markdown: this.emptyLocalizedText() });
      return { ...b, faq_items: items };
    });
  }

  removeHomeFaqItem(blockKey: string, idx: number): void {
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'faq') return b;
      const items = [...(b.faq_items || [])];
      if (items.length <= 1) return b;
      if (idx < 0 || idx >= items.length) return b;
      items.splice(idx, 1);
      return { ...b, faq_items: items };
    });
  }

  addHomeTestimonial(blockKey: string): void {
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'testimonials') return b;
      const items = [...(b.testimonials || [])];
      if (items.length >= 12) return b;
      items.push({ quote_markdown: this.emptyLocalizedText(), author: this.emptyLocalizedText(), role: this.emptyLocalizedText() });
      return { ...b, testimonials: items };
    });
  }

  removeHomeTestimonial(blockKey: string, idx: number): void {
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'testimonials') return b;
      const items = [...(b.testimonials || [])];
      if (items.length <= 1) return b;
      if (idx < 0 || idx >= items.length) return b;
      items.splice(idx, 1);
      return { ...b, testimonials: items };
    });
  }

  setBannerSlideImage(blockKey: string, asset: ContentImageAssetRead): void {
    const value = (asset?.url || '').trim();
    if (!value) return;
    const focalX = this.toFocalValue(asset.focal_x);
    const focalY = this.toFocalValue(asset.focal_y);
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'banner') return b;
      return { ...b, slide: { ...b.slide, image_url: value, focal_x: focalX, focal_y: focalY } };
    });
    this.toast.success(this.t('adminUi.site.assets.library.success.selected'));
  }

  addCarouselSlide(blockKey: string): void {
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'carousel') return b;
      return { ...b, slides: [...(b.slides || []), this.emptySlideDraft()] };
    });
  }

  removeCarouselSlide(blockKey: string, idx: number): void {
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'carousel') return b;
      const next = [...(b.slides || [])];
      next.splice(idx, 1);
      return { ...b, slides: next.length ? next : [this.emptySlideDraft()] };
    });
  }

  moveCarouselSlide(blockKey: string, idx: number, delta: number): void {
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'carousel') return b;
      const slides = [...(b.slides || [])];
      const from = idx;
      const to = idx + delta;
      if (from < 0 || from >= slides.length) return b;
      if (to < 0 || to >= slides.length) return b;
      const [moved] = slides.splice(from, 1);
      slides.splice(to, 0, moved);
      return { ...b, slides };
    });
  }

  setCarouselSlideImage(blockKey: string, idx: number, asset: ContentImageAssetRead): void {
    const value = (asset?.url || '').trim();
    if (!value) return;
    const focalX = this.toFocalValue(asset.focal_x);
    const focalY = this.toFocalValue(asset.focal_y);
    this.homeBlocks = this.homeBlocks.map((b) => {
      if (b.key !== blockKey || b.type !== 'carousel') return b;
      const slides = [...(b.slides || [])];
      const target = slides[idx];
      if (!target) return b;
      slides[idx] = { ...target, image_url: value, focal_x: focalX, focal_y: focalY };
      return { ...b, slides };
    });
    this.toast.success(this.t('adminUi.site.assets.library.success.selected'));
  }

  loadSections(): void {
    this.admin.getContent('home.sections').subscribe({
      next: (block) => this.applyLoadedSections(block),
      error: () => {
        delete this.contentVersions['home.sections'];
        this.resetHomeSectionsFromServer([]);
      }
    });
  }

  private applyLoadedSections(block: ContentBlock): void {
    this.rememberContentVersion('home.sections', block);
    const meta = this.toRecord(block.meta);
    const configured = this.parseConfiguredHomeBlocks(meta['blocks']);
    if (this.applyHomeSectionsFromServer(configured)) return;
    const derivedFromSections = this.deriveHomeSectionsFromMeta(meta['sections']);
    if (this.applyHomeSectionsFromServer(derivedFromSections)) return;
    const derivedFromOrder = this.deriveHomeSectionsFromOrder(meta['order']);
    if (this.applyHomeSectionsFromServer(derivedFromOrder)) return;
    this.resetHomeSectionsFromServer([]);
  }

  private applyHomeSectionsFromServer(blocks: HomeBlockDraft[]): boolean {
    if (!blocks.length) return false;
    this.resetHomeSectionsFromServer(blocks);
    return true;
  }

  private resetHomeSectionsFromServer(blocks: HomeBlockDraft[]): void {
    this.homeBlocks = this.ensureAllDefaultHomeBlocks(blocks);
    this.cmsHomeDraft.initFromServer(this.homeBlocks);
  }

  private parseConfiguredHomeBlocks(rawBlocks: unknown): HomeBlockDraft[] {
    if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) return [];
    const configured: HomeBlockDraft[] = [];
    const seenKeys = new Set<string>();
    const seenBuiltIns = new Set<HomeSectionId>();
    for (const raw of rawBlocks) {
      if (!raw || typeof raw !== 'object') continue;
      const parsed = this.parseConfiguredHomeBlock(raw as Record<string, unknown>, seenKeys, seenBuiltIns);
      if (parsed) configured.push(parsed);
    }
    return configured;
  }

  private parseConfiguredHomeBlock(
    rec: Record<string, unknown>,
    seenKeys: Set<string>,
    seenBuiltIns: Set<HomeSectionId>
  ): HomeBlockDraft | null {
    const typeRaw = typeof rec['type'] === 'string' ? String(rec['type']).trim() : '';
    const enabled = rec['enabled'] !== false;
    const builtIn = this.normalizeHomeSectionId(typeRaw);
    if (builtIn) {
      return this.buildConfiguredHomeBuiltInBlock(builtIn, enabled, seenKeys, seenBuiltIns);
    }
    const type = this.normalizeHomeCustomContentBlockType(typeRaw);
    if (!type) return null;
    const key = this.ensureUniqueConfiguredHomeBlockKey(rec['key'], this.nextCustomBlockKey(type), seenKeys);
    const draft = this.makeHomeBlockDraft(key, type, enabled);
    draft.title = this.toLocalizedText(rec['title']);
    this.homeConfiguredBlockHydrator(type)(draft, rec);
    return draft;
  }

  private buildConfiguredHomeBuiltInBlock(
    type: HomeSectionId,
    enabled: boolean,
    seenKeys: Set<string>,
    seenBuiltIns: Set<HomeSectionId>
  ): HomeBlockDraft | null {
    if (seenBuiltIns.has(type)) return null;
    seenBuiltIns.add(type);
    seenKeys.add(type);
    return this.makeHomeBlockDraft(type, type, enabled);
  }

  private ensureUniqueConfiguredHomeBlockKey(raw: unknown, fallback: string, seenKeys: Set<string>): string {
    const base = (typeof raw === 'string' ? raw.trim() : '') || fallback;
    let key = base;
    let i = 1;
    while (!key || seenKeys.has(key)) {
      key = `${base}-${i}`;
      i += 1;
    }
    seenKeys.add(key);
    return key;
  }

  private normalizeHomeCustomContentBlockType(value: string): HomeCustomContentBlockType | null {
    const type = value as HomeCustomContentBlockType;
    return HOME_CUSTOM_CONTENT_BLOCK_TYPE_SET.has(type) ? type : null;
  }

  private homeConfiguredBlockHydrator(
    type: HomeCustomContentBlockType
  ): (draft: HomeBlockDraft, rec: Record<string, unknown>) => void {
    const hydrators: Record<HomeCustomContentBlockType, (draft: HomeBlockDraft, rec: Record<string, unknown>) => void> = {
      text: (draft, rec) => this.hydrateConfiguredHomeTextBlock(draft, rec),
      columns: (draft, rec) => this.hydrateConfiguredHomeColumnsBlock(draft, rec),
      cta: (draft, rec) => this.hydrateConfiguredHomeCtaBlock(draft, rec),
      faq: (draft, rec) => this.hydrateConfiguredHomeFaqBlock(draft, rec),
      testimonials: (draft, rec) => this.hydrateConfiguredHomeTestimonialsBlock(draft, rec),
      image: (draft, rec) => this.hydrateConfiguredHomeImageBlock(draft, rec),
      gallery: (draft, rec) => this.hydrateConfiguredHomeGalleryBlock(draft, rec),
      banner: (draft, rec) => this.hydrateConfiguredHomeBannerBlock(draft, rec),
      carousel: (draft, rec) => this.hydrateConfiguredHomeCarouselBlock(draft, rec)
    };
    return hydrators[type];
  }

  private hydrateConfiguredHomeTextBlock(draft: HomeBlockDraft, rec: Record<string, unknown>): void {
    draft.body_markdown = this.toLocalizedText(rec['body_markdown']);
  }

  private hydrateConfiguredHomeColumnsBlock(draft: HomeBlockDraft, rec: Record<string, unknown>): void {
    const columnsRaw = rec['columns'];
    const cols: CmsColumnsColumnDraft[] = [];
    if (Array.isArray(columnsRaw)) {
      for (const colRaw of columnsRaw) {
        if (!colRaw || typeof colRaw !== 'object') continue;
        const colRec = colRaw as Record<string, unknown>;
        cols.push({ title: this.toLocalizedText(colRec['title']), body_markdown: this.toLocalizedText(colRec['body_markdown']) });
        if (cols.length >= 3) break;
      }
    }
    if (cols.length >= 2) draft.columns = cols;
    const bpRaw = rec['columns_breakpoint'] ?? rec['breakpoint'] ?? rec['stack_at'];
    const bp = typeof bpRaw === 'string' ? String(bpRaw).trim() : '';
    draft.columns_breakpoint = bp === 'sm' || bp === 'md' || bp === 'lg' ? bp : 'md';
  }

  private hydrateConfiguredHomeCtaBlock(draft: HomeBlockDraft, rec: Record<string, unknown>): void {
    draft.body_markdown = this.toLocalizedText(rec['body_markdown']);
    draft.cta_label = this.toLocalizedText(rec['cta_label']);
    draft.cta_url = typeof rec['cta_url'] === 'string' ? String(rec['cta_url']).trim() : '';
    draft.cta_new_tab = this.toBooleanValue(rec['cta_new_tab'], false);
  }

  private hydrateConfiguredHomeFaqBlock(draft: HomeBlockDraft, rec: Record<string, unknown>): void {
    const itemsRaw = rec['items'];
    const items: CmsFaqItemDraft[] = [];
    if (Array.isArray(itemsRaw)) {
      for (const itemRaw of itemsRaw) {
        if (!itemRaw || typeof itemRaw !== 'object') continue;
        const itemRec = itemRaw as Record<string, unknown>;
        items.push({
          question: this.toLocalizedText(itemRec['question']),
          answer_markdown: this.toLocalizedText(itemRec['answer_markdown'])
        });
        if (items.length >= 20) break;
      }
    }
    if (items.length) draft.faq_items = items;
  }

  private hydrateConfiguredHomeTestimonialsBlock(draft: HomeBlockDraft, rec: Record<string, unknown>): void {
    const itemsRaw = rec['items'];
    const items: CmsTestimonialDraft[] = [];
    if (Array.isArray(itemsRaw)) {
      for (const itemRaw of itemsRaw) {
        if (!itemRaw || typeof itemRaw !== 'object') continue;
        const itemRec = itemRaw as Record<string, unknown>;
        items.push({
          quote_markdown: this.toLocalizedText(itemRec['quote_markdown']),
          author: this.toLocalizedText(itemRec['author']),
          role: this.toLocalizedText(itemRec['role'])
        });
        if (items.length >= 12) break;
      }
    }
    if (items.length) draft.testimonials = items;
  }

  private hydrateConfiguredHomeImageBlock(draft: HomeBlockDraft, rec: Record<string, unknown>): void {
    draft.url = typeof rec['url'] === 'string' ? String(rec['url']).trim() : '';
    draft.link_url = typeof rec['link_url'] === 'string' ? String(rec['link_url']).trim() : '';
    draft.alt = this.toLocalizedText(rec['alt']);
    draft.caption = this.toLocalizedText(rec['caption']);
    draft.focal_x = this.toFocalValue(rec['focal_x']);
    draft.focal_y = this.toFocalValue(rec['focal_y']);
  }

  private hydrateConfiguredHomeGalleryBlock(draft: HomeBlockDraft, rec: Record<string, unknown>): void {
    const imagesRaw = rec['images'];
    if (!Array.isArray(imagesRaw)) return;
    for (const imgRaw of imagesRaw) {
      if (!imgRaw || typeof imgRaw !== 'object') continue;
      const imgRec = imgRaw as Record<string, unknown>;
      const url = typeof imgRec['url'] === 'string' ? String(imgRec['url']).trim() : '';
      if (!url) continue;
      draft.images.push({
        url,
        alt: this.toLocalizedText(imgRec['alt']),
        caption: this.toLocalizedText(imgRec['caption']),
        focal_x: this.toFocalValue(imgRec['focal_x']),
        focal_y: this.toFocalValue(imgRec['focal_y'])
      });
    }
  }

  private hydrateConfiguredHomeBannerBlock(draft: HomeBlockDraft, rec: Record<string, unknown>): void {
    draft.slide = this.toSlideDraft(rec['slide']);
  }

  private hydrateConfiguredHomeCarouselBlock(draft: HomeBlockDraft, rec: Record<string, unknown>): void {
    const slidesRaw = rec['slides'];
    const slides: SlideDraft[] = [];
    if (Array.isArray(slidesRaw)) {
      for (const slideRaw of slidesRaw) slides.push(this.toSlideDraft(slideRaw));
    }
    draft.slides = slides.length ? slides : [this.emptySlideDraft()];
    draft.settings = this.toCarouselSettingsDraft(rec['settings']);
  }

  private deriveHomeSectionsFromMeta(rawSections: unknown): HomeBlockDraft[] {
    if (!Array.isArray(rawSections)) return [];
    const derived: HomeBlockDraft[] = [];
    const seen = new Set<HomeSectionId>();
    for (const raw of rawSections) {
      if (!raw || typeof raw !== 'object') continue;
      const rec = raw as { id?: unknown; enabled?: unknown };
      this.appendDerivedHomeSection(derived, seen, rec.id, rec.enabled !== false);
    }
    return derived;
  }

  private deriveHomeSectionsFromOrder(rawOrder: unknown): HomeBlockDraft[] {
    if (!Array.isArray(rawOrder) || !rawOrder.length) return [];
    const derived: HomeBlockDraft[] = [];
    const seen = new Set<HomeSectionId>();
    for (const raw of rawOrder) {
      this.appendDerivedHomeSection(derived, seen, raw, true);
    }
    return derived;
  }

  private appendDerivedHomeSection(
    derived: HomeBlockDraft[],
    seen: Set<HomeSectionId>,
    rawId: unknown,
    enabled: boolean
  ): void {
    const id = this.normalizeHomeSectionId(rawId);
    if (!id || seen.has(id)) return;
    seen.add(id);
    derived.push(this.makeHomeBlockDraft(id, id, enabled));
  }

  private buildHomeSectionBlockMeta(block: HomeBlockDraft): Record<string, unknown> {
    const base: Record<string, unknown> = { key: block.key, type: block.type, enabled: block.enabled };
    this.homeSectionBlockMetaWriter(block.type)(base, block);
    return base;
  }

  private homeSectionBlockMetaWriter(type: HomeBlockType): (base: Record<string, unknown>, block: HomeBlockDraft) => void {
    const writers: Record<HomeBlockType, (base: Record<string, unknown>, block: HomeBlockDraft) => void> = {
      featured_products: () => undefined,
      sale_products: () => undefined,
      new_arrivals: () => undefined,
      featured_collections: () => undefined,
      story: () => undefined,
      recently_viewed: () => undefined,
      why: () => undefined,
      product_grid: () => undefined,
      form: () => undefined,
      text: (base, block) => this.writeHomeTextSectionMeta(base, block),
      columns: (base, block) => this.writeHomeColumnsSectionMeta(base, block),
      cta: (base, block) => this.writeHomeCtaSectionMeta(base, block),
      faq: (base, block) => this.writeHomeFaqSectionMeta(base, block),
      testimonials: (base, block) => this.writeHomeTestimonialsSectionMeta(base, block),
      image: (base, block) => this.writeHomeImageSectionMeta(base, block),
      gallery: (base, block) => this.writeHomeGallerySectionMeta(base, block),
      banner: (base, block) => this.writeHomeBannerSectionMeta(base, block),
      carousel: (base, block) => this.writeHomeCarouselSectionMeta(base, block)
    };
    return writers[type];
  }

  private writeHomeTextSectionMeta(base: Record<string, unknown>, block: HomeBlockDraft): void {
    base['title'] = block.title;
    base['body_markdown'] = block.body_markdown;
  }

  private writeHomeColumnsSectionMeta(base: Record<string, unknown>, block: HomeBlockDraft): void {
    base['title'] = block.title;
    base['columns'] = (block.columns || []).slice(0, 3).map((col) => ({ title: col.title, body_markdown: col.body_markdown }));
    base['columns_breakpoint'] = block.columns_breakpoint;
  }

  private writeHomeCtaSectionMeta(base: Record<string, unknown>, block: HomeBlockDraft): void {
    base['title'] = block.title;
    base['body_markdown'] = block.body_markdown;
    base['cta_label'] = block.cta_label;
    base['cta_url'] = block.cta_url;
    base['cta_new_tab'] = Boolean(block.cta_new_tab);
  }

  private writeHomeFaqSectionMeta(base: Record<string, unknown>, block: HomeBlockDraft): void {
    base['title'] = block.title;
    base['items'] = (block.faq_items || []).slice(0, 20).map((item) => ({ question: item.question, answer_markdown: item.answer_markdown }));
  }

  private writeHomeTestimonialsSectionMeta(base: Record<string, unknown>, block: HomeBlockDraft): void {
    base['title'] = block.title;
    base['items'] = (block.testimonials || []).slice(0, 12).map((item) => ({
      quote_markdown: item.quote_markdown,
      author: item.author,
      role: item.role
    }));
  }

  private writeHomeImageSectionMeta(base: Record<string, unknown>, block: HomeBlockDraft): void {
    base['title'] = block.title;
    base['url'] = block.url;
    base['link_url'] = block.link_url;
    base['alt'] = block.alt;
    base['caption'] = block.caption;
    base['focal_x'] = this.toFocalValue(block.focal_x);
    base['focal_y'] = this.toFocalValue(block.focal_y);
  }

  private writeHomeGallerySectionMeta(base: Record<string, unknown>, block: HomeBlockDraft): void {
    base['title'] = block.title;
    base['images'] = (block.images || []).map((img) => ({
      url: img.url,
      alt: img.alt,
      caption: img.caption,
      focal_x: this.toFocalValue(img.focal_x),
      focal_y: this.toFocalValue(img.focal_y)
    }));
  }

  private writeHomeBannerSectionMeta(base: Record<string, unknown>, block: HomeBlockDraft): void {
    base['title'] = block.title;
    base['slide'] = this.serializeSlideDraft(block.slide);
  }

  private writeHomeCarouselSectionMeta(base: Record<string, unknown>, block: HomeBlockDraft): void {
    base['title'] = block.title;
    base['slides'] = (block.slides || []).map((slide) => this.serializeSlideDraft(slide));
    base['settings'] = block.settings;
  }

  saveSections(): void {
    const blocks = this.homeBlocks.map((block) => this.buildHomeSectionBlockMeta(block));

    const sections: Array<{ id: HomeSectionId; enabled: boolean }> = [];
    const seen = new Set<HomeSectionId>();
    for (const block of this.homeBlocks) {
      if (!this.isHomeSectionId(block.type)) continue;
      const id: HomeSectionId = block.type;
      if (seen.has(id)) continue;
      seen.add(id);
      sections.push({ id, enabled: block.enabled });
    }

    const payload = {
      title: 'Home sections',
      body_markdown: 'Home layout order',
      meta: { version: 2, blocks, sections, order: sections.map((s) => s.id) },
      status: 'published'
    };
    const ok = this.t('adminUi.home.sections.success.save');
    const errMsg = this.t('adminUi.home.sections.errors.save');
	    this.admin.updateContentBlock('home.sections', this.withExpectedVersion('home.sections', payload)).subscribe({
	      next: (block) => {
	        this.rememberContentVersion('home.sections', block);
	        this.sectionsMessage = ok;
	        this.cmsHomeDraft.markServerSaved(this.homeBlocks, true);
        this.refreshHomePreview();
	      },
	      error: (err) => {
	        if (this.handleContentConflict(err, 'home.sections', () => this.loadSections())) {
	          this.sectionsMessage = errMsg;
	          return;
        }
        if (err?.status === 404) {
	          this.admin.createContent('home.sections', payload).subscribe({
	            next: (created) => {
	              this.rememberContentVersion('home.sections', created);
	              this.sectionsMessage = ok;
	              this.cmsHomeDraft.markServerSaved(this.homeBlocks, true);
                this.refreshHomePreview();
	            },
	            error: () => (this.sectionsMessage = errMsg)
	          });
	        } else {
	          this.sectionsMessage = errMsg;
        }
      }
    });
  }

  // Categories
  loadCategories(): void {
    this.admin.getCategories().subscribe({
      next: (cats) => {
        this.categories = cats
          .map((c) => ({ ...c, sort_order: c.sort_order ?? 0 }))
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      },
      error: () => (this.categories = [])
    });
  }

  // Featured collections
  loadCollections(): void {
    this.admin.listFeaturedCollections().subscribe({
      next: (cols) => (this.featuredCollections = cols),
      error: () => (this.featuredCollections = [])
    });
  }

  resetCollectionForm(): void {
    this.editingCollection = null;
    this.collectionForm = { name: '', description: '', product_ids: [] };
    this.collectionMessage = '';
  }

  editCollection(col: FeaturedCollection): void {
    this.editingCollection = col.slug;
    this.collectionForm = {
      name: col.name,
      description: col.description || '',
      product_ids: col.product_ids || []
    };
  }

  saveCollection(): void {
    if (!this.collectionForm.name) {
      this.toast.error(this.t('adminUi.home.collections.errors.required'));
      return;
    }
    const payload = {
      name: this.collectionForm.name,
      description: this.collectionForm.description,
      product_ids: this.collectionForm.product_ids
    };
    const obs = this.editingCollection
      ? this.admin.updateFeaturedCollection(this.editingCollection, payload)
      : this.admin.createFeaturedCollection(payload);
    obs.subscribe({
      next: (col) => {
        const existing = this.featuredCollections.find((c) => c.slug === col.slug);
        if (existing) {
          this.featuredCollections = this.featuredCollections.map((c) => (c.slug === col.slug ? col : c));
        } else {
          this.featuredCollections = [col, ...this.featuredCollections];
        }
        this.collectionMessage = this.t('adminUi.home.collections.success.saved');
        this.editingCollection = null;
      },
      error: () => this.toast.error(this.t('adminUi.home.collections.errors.save'))
    });
  }

  saveMaintenance(): void {
    this.admin.setMaintenance(this.maintenanceEnabledValue).subscribe({
      next: (res) => {
        this.maintenanceEnabled.set(res.enabled);
        this.maintenanceEnabledValue = res.enabled;
        this.toast.success(this.t('adminUi.maintenance.success.update'));
      },
      error: () => this.toast.error(this.t('adminUi.maintenance.errors.update'))
    });
  }
}
