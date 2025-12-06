import { TestBed } from '@angular/core/testing';
import { ProductComponent } from './product.component';
import { ToastService } from '../../core/toast.service';
import { CartStore } from '../../core/cart.store';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';

describe('ProductComponent', () => {
  let toast: any;
  let cart: any;

  beforeEach(() => {
    toast = jasmine.createSpyObj('ToastService', ['success']);
    cart = jasmine.createSpyObj('CartStore', ['addFromProduct']);

    TestBed.configureTestingModule({
      imports: [ProductComponent, HttpClientTestingModule, TranslateModule.forRoot()],
      providers: [
        { provide: ToastService, useValue: toast },
        { provide: CartStore, useValue: cart },
        { provide: ActivatedRoute, useValue: { params: of({ slug: 'prod' }) } },
        { provide: 'CatalogService', useValue: { getProductBySlug: () => of(null) } },
        { provide: 'Title', useValue: { setTitle: () => {} } },
        { provide: 'Meta', useValue: { updateTag: () => {} } }
      ]
    });
  });

  it('posts add-to-cart and shows toast', () => {
    const fixture = TestBed.createComponent(ProductComponent);
    const cmp = fixture.componentInstance;
    cmp.product = {
      id: 'p1',
      slug: 'p1',
      name: 'Product',
      base_price: 25,
      currency: 'USD',
      stock_quantity: 5,
      images: [{ url: '/img.png' }],
    } as any;
    cmp.addToCart();

    expect(cart.addFromProduct).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });
});
