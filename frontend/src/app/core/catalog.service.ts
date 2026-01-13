import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type SortOption = 'newest' | 'price_asc' | 'price_desc' | 'name_asc' | 'name_desc';

export interface Category {
  slug: string;
  name: string;
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

export interface Product {
  id: string;
  slug: string;
  name: string;
  short_description?: string;
  long_description?: string;
  base_price: number;
  currency: string;
  stock_quantity?: number | null;
  allow_backorder?: boolean | null;
  rating_average?: number;
  rating_count?: number;
  images?: ProductImage[];
  tags?: { slug: string; name: string }[];
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

  listCategories(): Observable<Category[]> {
    return this.api.get<Category[]>('/catalog/categories');
  }

  listProducts(params: ProductFilterParams): Observable<ProductListResponse> {
    return this.api.get<ProductListResponse>('/catalog/products', {
      category_slug: params.category_slug,
      search: params.search,
      min_price: params.min_price,
      max_price: params.max_price,
      is_featured: params.is_featured,
      tags: params.tags?.length ? params.tags : undefined,
      sort: params.sort,
      page: params.page ?? 1,
      limit: params.limit ?? 12
    });
  }

  getProduct(slug: string): Observable<Product> {
    return this.api.get<Product>(`/catalog/products/${slug}`);
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

  getProductPriceBounds(params: Pick<ProductFilterParams, 'category_slug' | 'search' | 'is_featured' | 'tags'>): Observable<ProductPriceBounds> {
    return this.api.get<ProductPriceBounds>('/catalog/products/price-bounds', {
      category_slug: params.category_slug,
      search: params.search,
      is_featured: params.is_featured,
      tags: params.tags?.length ? params.tags : undefined
    });
  }

  listFeaturedCollections(): Observable<FeaturedCollection[]> {
    return this.api.get<FeaturedCollection[]>('/catalog/collections/featured');
  }
}
