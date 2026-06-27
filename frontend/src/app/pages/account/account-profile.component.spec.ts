import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { AccountProfileComponent } from './account-profile.component';
import { AccountComponent } from './account.component';

interface AccountMock {
  profileHasUnsavedChanges: jasmine.Spy;
  discardProfileChanges: jasmine.Spy;
  uploadAvatar: jasmine.Spy;
  avatarBusy: boolean;
}

describe('AccountProfileComponent', () => {
  let account: AccountMock;

  function makeComponent(): AccountProfileComponent {
    return TestBed.createComponent(AccountProfileComponent).componentInstance;
  }

  beforeEach(() => {
    account = {
      profileHasUnsavedChanges: jasmine.createSpy('profileHasUnsavedChanges'),
      discardProfileChanges: jasmine.createSpy('discardProfileChanges'),
      uploadAvatar: jasmine.createSpy('uploadAvatar'),
      avatarBusy: false,
    };

    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AccountProfileComponent],
      providers: [{ provide: AccountComponent, useValue: account as unknown as AccountComponent }],
    });
  });

  describe('unsaved-changes delegation', () => {
    it('delegates hasUnsavedChanges to the account state', () => {
      account.profileHasUnsavedChanges.and.returnValue(true);
      const cmp = makeComponent();
      expect(cmp.hasUnsavedChanges()).toBeTrue();
      expect(account.profileHasUnsavedChanges).toHaveBeenCalledTimes(1);
    });

    it('delegates discardUnsavedChanges to the account state', () => {
      const cmp = makeComponent();
      cmp.discardUnsavedChanges();
      expect(account.discardProfileChanges).toHaveBeenCalledTimes(1);
    });
  });

  describe('avatarCropReady getter', () => {
    it('is true only when a url, an image and no error are all present', () => {
      const cmp = makeComponent();
      cmp.avatarCropUrl = 'blob:x';
      (cmp as unknown as { avatarImage: unknown }).avatarImage = {};
      cmp.avatarCropErrorKey = null;
      expect(cmp.avatarCropReady).toBeTrue();
    });

    it('is false when the url is missing', () => {
      const cmp = makeComponent();
      cmp.avatarCropUrl = null;
      (cmp as unknown as { avatarImage: unknown }).avatarImage = {};
      expect(cmp.avatarCropReady).toBeFalse();
    });

    it('is false when the decoded image is missing', () => {
      const cmp = makeComponent();
      cmp.avatarCropUrl = 'blob:x';
      (cmp as unknown as { avatarImage: unknown }).avatarImage = null;
      expect(cmp.avatarCropReady).toBeFalse();
    });

    it('is false when there is a crop error key', () => {
      const cmp = makeComponent();
      cmp.avatarCropUrl = 'blob:x';
      (cmp as unknown as { avatarImage: unknown }).avatarImage = {};
      cmp.avatarCropErrorKey = 'account.profile.avatar.crop.errors.previewLoad';
      expect(cmp.avatarCropReady).toBeFalse();
    });
  });

  describe('avatarCropTransform getter', () => {
    it('uses a clamped finite zoom value', () => {
      const cmp = makeComponent();
      cmp.avatarCropZoom = 2;
      expect(cmp.avatarCropTransform).toBe('translate(-50%, -50%) scale(2)');
    });

    it('clamps an out-of-range finite zoom to the maximum', () => {
      const cmp = makeComponent();
      cmp.avatarCropZoom = 9;
      expect(cmp.avatarCropTransform).toBe('translate(-50%, -50%) scale(3)');
    });

    it('falls back to scale 1 for a non-finite zoom', () => {
      const cmp = makeComponent();
      cmp.avatarCropZoom = 'abc' as unknown as number;
      expect(cmp.avatarCropTransform).toBe('translate(-50%, -50%) scale(1)');
    });
  });

  describe('onAvatarFileChange', () => {
    let OrigImage: typeof Image;
    let createdImage: { onload: (() => void) | null; onerror: (() => void) | null; src: string };

    beforeEach(() => {
      OrigImage = window.Image;
      class FakeImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        private _src = '';
        set src(value: string) {
          this._src = value;
        }
        get src(): string {
          return this._src;
        }
        constructor() {
          createdImage = this as unknown as typeof createdImage;
        }
      }
      (window as unknown as { Image: unknown }).Image = FakeImage;
    });

    afterEach(() => {
      (window as unknown as { Image: unknown }).Image = OrigImage;
    });

    it('does nothing when no file is selected', () => {
      const cmp = makeComponent();
      const input = { files: [] as File[], value: 'keep' } as unknown as HTMLInputElement;
      cmp.onAvatarFileChange({ target: input } as unknown as Event);
      expect(input.value).toBe('');
      expect(cmp.avatarCropOpen).toBeFalse();
    });

    it('does nothing when the input has a null file list', () => {
      const cmp = makeComponent();
      const input = { files: null, value: 'keep' } as unknown as HTMLInputElement;
      cmp.onAvatarFileChange({ target: input } as unknown as Event);
      expect(input.value).toBe('');
      expect(cmp.avatarCropOpen).toBeFalse();
    });

    it('ignores non-image files', () => {
      const cmp = makeComponent();
      const file = new File(['x'], 'note.txt', { type: 'text/plain' });
      const input = { files: [file], value: 'keep' } as unknown as HTMLInputElement;
      cmp.onAvatarFileChange({ target: input } as unknown as Event);
      expect(cmp.avatarCropOpen).toBeFalse();
    });

    it('opens the cropper for an image and stores the decoded image on load', () => {
      spyOn(URL, 'createObjectURL').and.returnValue('blob:fake');
      const cmp = makeComponent();
      const file = new File(['x'], 'pic.png', { type: 'image/png' });
      const input = { files: [file], value: 'keep' } as unknown as HTMLInputElement;
      cmp.onAvatarFileChange({ target: input } as unknown as Event);

      expect(cmp.avatarCropOpen).toBeTrue();
      expect(cmp.avatarCropUrl).toBe('blob:fake');
      expect(cmp.avatarCropZoom).toBe(1);
      expect(cmp.avatarCropErrorKey).toBeNull();
      expect(createdImage.src).toBe('blob:fake');

      createdImage.onload?.();
      expect(cmp.avatarCropReady).toBeTrue();
    });

    it('records a preview-load error when the image fails to decode', () => {
      spyOn(URL, 'createObjectURL').and.returnValue('blob:fake');
      const cmp = makeComponent();
      const file = new File(['x'], 'pic.png', { type: 'image/png' });
      const input = { files: [file], value: 'keep' } as unknown as HTMLInputElement;
      cmp.onAvatarFileChange({ target: input } as unknown as Event);

      createdImage.onerror?.();
      expect(cmp.avatarCropErrorKey).toBe('account.profile.avatar.crop.errors.previewLoad');
    });
  });

  describe('cancelAvatarCrop', () => {
    it('does not reset while an avatar upload is busy', () => {
      account.avatarBusy = true;
      const cmp = makeComponent();
      cmp.avatarCropOpen = true;
      cmp.cancelAvatarCrop();
      expect(cmp.avatarCropOpen).toBeTrue();
    });

    it('resets crop state when not busy (no url to revoke)', () => {
      const cmp = makeComponent();
      cmp.avatarCropOpen = true;
      cmp.avatarCropUrl = null;
      cmp.cancelAvatarCrop();
      expect(cmp.avatarCropOpen).toBeFalse();
    });
  });

  describe('confirmAvatarCrop', () => {
    function stubCanvas(canvas: Partial<HTMLCanvasElement>): void {
      const origCreate = document.createElement.bind(document);
      spyOn(document, 'createElement').and.callFake((tag: string) =>
        tag === 'canvas' ? (canvas as HTMLCanvasElement) : origCreate(tag as 'div'),
      );
    }

    it('returns early when an avatar upload is busy', async () => {
      account.avatarBusy = true;
      const cmp = makeComponent();
      await cmp.confirmAvatarCrop();
      expect(account.uploadAvatar).not.toHaveBeenCalled();
    });

    it('returns early when there is no decoded image', async () => {
      const cmp = makeComponent();
      (cmp as unknown as { avatarImage: unknown }).avatarImage = null;
      await cmp.confirmAvatarCrop();
      expect(account.uploadAvatar).not.toHaveBeenCalled();
    });

    it('returns early when there is no crop url', async () => {
      const cmp = makeComponent();
      (cmp as unknown as { avatarImage: unknown }).avatarImage = {
        naturalWidth: 100,
        naturalHeight: 200,
      };
      cmp.avatarCropUrl = null;
      await cmp.confirmAvatarCrop();
      expect(account.uploadAvatar).not.toHaveBeenCalled();
    });

    it('aborts and resets when the canvas 2d context is unavailable', async () => {
      stubCanvas({ getContext: () => null } as unknown as HTMLCanvasElement);
      const cmp = makeComponent();
      (cmp as unknown as { avatarImage: unknown }).avatarImage = {
        naturalWidth: 100,
        naturalHeight: 200,
      };
      cmp.avatarCropUrl = 'blob:fake';
      cmp.avatarCropOpen = true;
      await cmp.confirmAvatarCrop();
      expect(account.uploadAvatar).not.toHaveBeenCalled();
      expect(cmp.avatarCropOpen).toBeFalse();
    });

    it('aborts and resets when the canvas yields no blob (non-finite zoom)', async () => {
      const drawImage = jasmine.createSpy('drawImage');
      stubCanvas({
        getContext: () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
        toBlob: (cb: BlobCallback) => cb(null),
      } as unknown as HTMLCanvasElement);
      const cmp = makeComponent();
      (cmp as unknown as { avatarImage: unknown }).avatarImage = {
        naturalWidth: 100,
        naturalHeight: 200,
      };
      cmp.avatarCropUrl = 'blob:fake';
      cmp.avatarCropOpen = true;
      cmp.avatarCropZoom = 'nope' as unknown as number;
      await cmp.confirmAvatarCrop();
      expect(drawImage).toHaveBeenCalled();
      expect(account.uploadAvatar).not.toHaveBeenCalled();
      expect(cmp.avatarCropOpen).toBeFalse();
    });

    it('uploads a cropped avatar file on success (finite zoom)', async () => {
      const blob = new Blob(['png'], { type: 'image/png' });
      const drawImage = jasmine.createSpy('drawImage');
      stubCanvas({
        getContext: () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
        toBlob: (cb: BlobCallback) => cb(blob),
      } as unknown as HTMLCanvasElement);
      const cmp = makeComponent();
      (cmp as unknown as { avatarImage: unknown }).avatarImage = {
        naturalWidth: 100,
        naturalHeight: 200,
      };
      cmp.avatarCropUrl = 'blob:fake';
      cmp.avatarCropOpen = true;
      cmp.avatarCropZoom = 2;
      await cmp.confirmAvatarCrop();

      expect(drawImage).toHaveBeenCalled();
      expect(account.uploadAvatar).toHaveBeenCalledTimes(1);
      const uploaded = account.uploadAvatar.calls.mostRecent().args[0] as File;
      expect(uploaded.name).toBe('avatar.png');
      expect(cmp.avatarCropOpen).toBeFalse();
    });
  });

  describe('ngOnDestroy', () => {
    it('revokes the object url and resets crop state', () => {
      const revoke = spyOn(URL, 'revokeObjectURL');
      const cmp = makeComponent();
      cmp.avatarCropOpen = true;
      cmp.avatarCropUrl = 'blob:fake';
      cmp.ngOnDestroy();
      expect(revoke).toHaveBeenCalledWith('blob:fake');
      expect(cmp.avatarCropOpen).toBeFalse();
      expect(cmp.avatarCropUrl).toBeNull();
    });
  });
});
