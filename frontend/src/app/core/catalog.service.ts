import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { parseMoney } from '../shared/money';
import { map } from 'rxjs/operators';

export type SortOption = 'newest' | 'price_asc' | 'price_desc' | 'name_asc' | 'name_desc';

export interface Category {
  id: string;
  slug: string;
  name: string;
  parent_id?: string | null;
  sort_order?: number;
}

export interface ProductImage {
  url: string;
  alt_text?: string | null;
}

export interface ProductVariant {
  id: string;
  name: string;
  stock_quantity: number | null;
}

export type ProductBadgeType = 'new' | 'limited' | 'handmade';

export interface ProductBadge {
  id: string;
  badge: ProductBadgeType;
  start_at?: string | null;
  end_at?: string | null;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  short_description?: string;
  long_description?: string;
  base_price: number;
  sale_price?: number | null;
  sale_type?: 'percent' | 'amount' | null;
  sale_value?: number | null;
  currency: string;
  stock_quantity?: number | null;
  allow_backorder?: boolean | null;
  rating_average?: number;
  rating_count?: number;
  images?: ProductImage[];
  tags?: { slug: string; name: string }[];
  badges?: ProductBadge[];
  variants?: ProductVariant[];
}

export interface FeaturedCollection {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  created_at: string;
  products: Product[];
}

export interface PaginationMeta {
  total_items: number;
  total_pages: number;
  page: number;
  limit: number;
}

export interface ProductListResponse {
  items: Product[];
  meta: PaginationMeta;
  bounds?: ProductPriceBounds;
}

export interface ProductPriceBounds {
  min_price: number;
  max_price: number;
  currency?: string | null;
}

export interface ProductFilterParams {
  category_slug?: string;
  on_sale?: boolean;
  search?: string;
  min_price?: number;
  max_price?: number;
  is_featured?: boolean;
  tags?: string[];
  sort?: SortOption;
  page?: number;
  limit?: number;
}

export interface BackInStockRequest {
  id: string;
  created_at: string;
  fulfilled_at?: string | null;
  canceled_at?: string | null;
  notified_at?: string | null;
}

export interface BackInStockStatus {
  in_stock: boolean;
  request?: BackInStockRequest | null;
}

@Injectable({ providedIn: 'root' })
export class CatalogService {
  constructor(private api: ApiService) {}

  private normalizeProduct(raw: any): Product {
    return {
      ...(raw ?? {}),
      base_price: parseMoney(raw?.base_price),
      sale_price: raw?.sale_price == null ? null : parseMoney(raw.sale_price),
      sale_value: raw?.sale_value == null ? null : parseMoney(raw.sale_value)
    } as Product;
  }

  listCategories(): Observable<Category[]> {
    return this.api.get<Category[]>('/catalog/categories');
  }

  listProducts(params: ProductFilterParams): Observable<ProductListResponse> {
    return this.api
      .get<ProductListResponse>('/catalog/products', {
      category_slug: params.category_slug,
      on_sale: params.on_sale,
      search: params.search,
      min_price: params.min_price,
      max_price: params.max_price,
      is_featured: params.is_featured,
      tags: params.tags?.length ? params.tags : undefined,
      sort: params.sort,
      page: params.page ?? 1,
      limit: params.limit ?? 12
    })
      .pipe(
        map((res: any) => ({
          ...(res ?? {}),
          items: (res?.items ?? []).map((p: any) => this.normalizeProduct(p))
        }))
      );
  }

  getProduct(slug: string): Observable<Product> {
    return this.api.get<Product>(`/catalog/products/${slug}`).pipe(map((p: any) => this.normalizeProduct(p)));
  }

  getRelatedProducts(slug: string): Observable<Product[]> {
    return this.api.get<Product[]>(`/catalog/products/${slug}/related`).pipe(map((rows: any) => (rows ?? []).map((p: any) => this.normalizeProduct(p))));
  }

  getUpsellProducts(slug: string): Observable<Product[]> {
    return this.api.get<Product[]>(`/catalog/products/${slug}/upsells`).pipe(map((rows: any) => (rows ?? []).map((p: any) => this.normalizeProduct(p))));
  }

  getBackInStockStatus(slug: string): Observable<BackInStockStatus> {
    return this.api.get<BackInStockStatus>(`/catalog/products/${slug}/back-in-stock`);
  }

  requestBackInStock(slug: string): Observable<BackInStockRequest> {
    return this.api.post<BackInStockRequest>(`/catalog/products/${slug}/back-in-stock`, {});
  }

  cancelBackInStock(slug: string): Observable<void> {
    return this.api.delete<void>(`/catalog/products/${slug}/back-in-stock`);
  }

  getProductPriceBounds(
    params: Pick<ProductFilterParams, 'category_slug' | 'on_sale' | 'search' | 'is_featured' | 'tags'>
  ): Observable<ProductPriceBounds> {
    return this.api.get<ProductPriceBounds>('/catalog/products/price-bounds', {
      category_slug: params.category_slug,
      on_sale: params.on_sale,
      search: params.search,
      is_featured: params.is_featured,
      tags: params.tags?.length ? params.tags : undefined
    });
  }

  listFeaturedCollections(): Observable<FeaturedCollection[]> {
    return this.api.get<FeaturedCollection[]>('/catalog/collections/featured').pipe(
      map((rows: any) =>
        (rows ?? []).map((c: any) => ({
          ...(c ?? {}),
          products: (c?.products ?? []).map((p: any) => this.normalizeProduct(p))
        }))
      )
    );
  }
}
