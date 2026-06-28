import { TestBed } from '@angular/core/testing';

import { AccountProfileComponent } from './account-profile.component';
import { AccountComponent } from './account.component';

interface AccountMock {
  profileHasUnsavedChanges: jasmine.Spy<() => boolean>;
  discardProfileChanges: jasmine.Spy<() => void>;
  uploadAvatar: jasmine.Spy<(file: File) => void>;
  avatarBusy: boolean;
}

function createComponent(account: AccountMock): AccountProfileComponent {
  TestBed.configureTestingModule({
    providers: [{ provide: AccountComponent, useValue: account }],
  });
  return TestBed.runInInjectionContext(() => new AccountProfileComponent());
}

function makeAccount(): AccountMock {
  return {
    profileHasUnsavedChanges: jasmine.createSpy('profileHasUnsavedChanges').and.returnValue(false),
    discardProfileChanges: jasmine.createSpy('discardProfileChanges'),
    uploadAvatar: jasmine.createSpy('uploadAvatar'),
    avatarBusy: false,
  };
}

describe('AccountProfileComponent', () => {
  let account: AccountMock;
  let cmp: AccountProfileComponent;

  beforeEach(() => {
    account = makeAccount();
    cmp = createComponent(account);
  });

  it('initialises with closed crop state and default flags', () => {
    expect(cmp.showUsernamePassword).toBeFalse();
    expect(cmp.avatarCropOpen).toBeFalse();
    expect(cmp.avatarCropUrl).toBeNull();
    expect(cmp.avatarCropZoom).toBe(1);
    expect(cmp.avatarCropErrorKey).toBeNull();
  });

  describe('unsaved-changes delegation', () => {
    it('reports unsaved changes from the account state', () => {
      account.profileHasUnsavedChanges.and.returnValue(true);
      expect(cmp.hasUnsavedChanges()).toBeTrue();

      account.profileHasUnsavedChanges.and.returnValue(false);
      expect(cmp.hasUnsavedChanges()).toBeFalse();
    });

    it('delegates discarding changes to the account state', () => {
      cmp.discardUnsavedChanges();
      expect(account.discardProfileChanges).toHaveBeenCalledTimes(1);
    });
  });

  describe('avatarCropReady', () => {
    it('is false when no crop url is present', () => {
      cmp.avatarCropUrl = null;
      expect(cmp.avatarCropReady).toBeFalse();
    });

    it('is false when the image has not loaded yet', () => {
      cmp.avatarCropUrl = 'blob:test';
      // avatarImage still null
      expect(cmp.avatarCropReady).toBeFalse();
    });

    it('is false when there is a crop error', () => {
      cmp.avatarCropUrl = 'blob:test';
      (cmp as unknown as { avatarImage: unknown }).avatarImage = {} as HTMLImageElement;
      cmp.avatarCropErrorKey = 'account.profile.avatar.crop.errors.previewLoad';
      expect(cmp.avatarCropReady).toBeFalse();
    });

    it('is true when url, image and no error are all present', () => {
      cmp.avatarCropUrl = 'blob:test';
      (cmp as unknown as { avatarImage: unknown }).avatarImage = {} as HTMLImageElement;
      cmp.avatarCropErrorKey = null;
      expect(cmp.avatarCropReady).toBeTrue();
    });
  });

  describe('avatarCropTransform', () => {
    it('uses the configured zoom when finite and in range', () => {
      cmp.avatarCropZoom = 2;
      expect(cmp.avatarCropTransform).toBe('translate(-50%, -50%) scale(2)');
    });

    it('clamps zoom above the maximum to 3', () => {
      cmp.avatarCropZoom = 5;
      expect(cmp.avatarCropTransform).toBe('translate(-50%, -50%) scale(3)');
    });

    it('clamps zoom below the minimum to 1', () => {
      cmp.avatarCropZoom = 0.5;
      expect(cmp.avatarCropTransform).toBe('translate(-50%, -50%) scale(1)');
    });

    it('falls back to 1 when the zoom is not a finite number', () => {
      cmp.avatarCropZoom = 'not-a-number' as unknown as number;
      expect(cmp.avatarCropTransform).toBe('translate(-50%, -50%) scale(1)');
    });
  });

  describe('onAvatarFileChange', () => {
    let createObjectURLSpy: jasmine.Spy;

    beforeEach(() => {
      createObjectURLSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:created');
      spyOn(URL, 'revokeObjectURL');
    });

    function fileEvent(files: File[] | null): Event {
      const input = { files, value: 'C:/fake/path.png' } as unknown as HTMLInputElement;
      return { target: input } as unknown as Event;
    }

    it('ignores the change when no file is selected and clears the input', () => {
      const event = fileEvent(null);
      cmp.onAvatarFileChange(event);
      expect((event.target as HTMLInputElement).value).toBe('');
      expect(createObjectURLSpy).not.toHaveBeenCalled();
      expect(cmp.avatarCropOpen).toBeFalse();
    });

    it('ignores non-image files', () => {
      const file = new File(['x'], 'note.txt', { type: 'text/plain' });
      cmp.onAvatarFileChange(fileEvent([file]));
      expect(createObjectURLSpy).not.toHaveBeenCalled();
      expect(cmp.avatarCropOpen).toBeFalse();
    });

    it('opens the cropper and stores the loaded image on success', () => {
      const fakeImg: Partial<HTMLImageElement> = {};
      spyOn(window, 'Image').and.returnValue(fakeImg as HTMLImageElement);

      const file = new File(['x'], 'pic.png', { type: 'image/png' });
      cmp.onAvatarFileChange(fileEvent([file]));

      expect(createObjectURLSpy).toHaveBeenCalledWith(file);
      expect(cmp.avatarCropOpen).toBeTrue();
      expect(cmp.avatarCropUrl).toBe('blob:created');
      expect(cmp.avatarCropZoom).toBe(1);
      expect(cmp.avatarCropErrorKey).toBeNull();
      expect(fakeImg.src).toBe('blob:created');

      // Simulate the image loading successfully.
      (fakeImg.onload as () => void)();
      expect((cmp as unknown as { avatarImage: unknown }).avatarImage).toBe(fakeImg);
      expect(cmp.avatarCropReady).toBeTrue();
    });

    it('sets a preview-load error when the image fails to load', () => {
      const fakeImg: Partial<HTMLImageElement> = {};
      spyOn(window, 'Image').and.returnValue(fakeImg as HTMLImageElement);

      const file = new File(['x'], 'pic.png', { type: 'image/png' });
      cmp.onAvatarFileChange(fileEvent([file]));

      (fakeImg.onerror as () => void)();
      expect(cmp.avatarCropErrorKey).toBe('account.profile.avatar.crop.errors.previewLoad');
      expect(cmp.avatarCropReady).toBeFalse();
    });
  });

  describe('cancelAvatarCrop', () => {
    it('does nothing while an avatar upload is in flight', () => {
      account.avatarBusy = true;
      cmp.avatarCropOpen = true;
      cmp.avatarCropUrl = 'blob:test';
      cmp.cancelAvatarCrop();
      expect(cmp.avatarCropOpen).toBeTrue();
      expect(cmp.avatarCropUrl).toBe('blob:test');
    });

    it('closes and resets the cropper when idle', () => {
      const revokeSpy = spyOn(URL, 'revokeObjectURL');
      cmp.avatarCropOpen = true;
      cmp.avatarCropUrl = 'blob:test';
      cmp.cancelAvatarCrop();
      expect(cmp.avatarCropOpen).toBeFalse();
      expect(cmp.avatarCropUrl).toBeNull();
      expect(revokeSpy).toHaveBeenCalledWith('blob:test');
    });

    it('skips revoking when there is no crop url', () => {
      const revokeSpy = spyOn(URL, 'revokeObjectURL');
      cmp.avatarCropOpen = true;
      cmp.avatarCropUrl = null;
      cmp.cancelAvatarCrop();
      expect(cmp.avatarCropOpen).toBeFalse();
      expect(revokeSpy).not.toHaveBeenCalled();
    });
  });

  describe('confirmAvatarCrop', () => {
    function primeReadyCrop(zoom: number | string = 2): void {
      (cmp as unknown as { avatarImage: HTMLImageElement }).avatarImage = {
        naturalWidth: 200,
        naturalHeight: 100,
      } as HTMLImageElement;
      cmp.avatarCropUrl = 'blob:test';
      cmp.avatarCropZoom = zoom as number;
    }

    it('does nothing while an avatar upload is in flight', async () => {
      account.avatarBusy = true;
      primeReadyCrop();
      await cmp.confirmAvatarCrop();
      expect(account.uploadAvatar).not.toHaveBeenCalled();
    });

    it('does nothing when there is no loaded image', async () => {
      cmp.avatarCropUrl = 'blob:test';
      await cmp.confirmAvatarCrop();
      expect(account.uploadAvatar).not.toHaveBeenCalled();
    });

    it('does nothing when there is no crop url', async () => {
      (cmp as unknown as { avatarImage: HTMLImageElement }).avatarImage = {
        naturalWidth: 200,
        naturalHeight: 100,
      } as HTMLImageElement;
      cmp.avatarCropUrl = null;
      await cmp.confirmAvatarCrop();
      expect(account.uploadAvatar).not.toHaveBeenCalled();
    });

    it('resets without uploading when a 2d context is unavailable', async () => {
      spyOn(URL, 'revokeObjectURL');
      spyOn(HTMLCanvasElement.prototype, 'getContext').and.returnValue(null);
      primeReadyCrop();
      await cmp.confirmAvatarCrop();
      expect(account.uploadAvatar).not.toHaveBeenCalled();
      expect(cmp.avatarCropOpen).toBeFalse();
      expect(cmp.avatarCropUrl).toBeNull();
    });

    it('resets without uploading when the canvas yields no blob', async () => {
      spyOn(URL, 'revokeObjectURL');
      spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
      spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake(function (
        this: HTMLCanvasElement,
        cb: BlobCallback,
      ) {
        cb(null);
      });
      primeReadyCrop();
      await cmp.confirmAvatarCrop();
      expect(account.uploadAvatar).not.toHaveBeenCalled();
      expect(cmp.avatarCropUrl).toBeNull();
    });

    it('uploads a cropped avatar file on success', async () => {
      const revokeSpy = spyOn(URL, 'revokeObjectURL');
      const drawSpy = spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
      const blob = new Blob(['img'], { type: 'image/png' });
      spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake(function (
        this: HTMLCanvasElement,
        cb: BlobCallback,
      ) {
        cb(blob);
      });
      primeReadyCrop(2);

      await cmp.confirmAvatarCrop();

      // base = min(200,100)=100, crop = 100/2 = 50, centred source rect.
      expect(drawSpy).toHaveBeenCalledWith(
        jasmine.anything() as unknown as CanvasImageSource,
        75,
        25,
        50,
        50,
        0,
        0,
        512,
        512,
      );
      expect(account.uploadAvatar).toHaveBeenCalledTimes(1);
      const uploaded = account.uploadAvatar.calls.mostRecent().args[0];
      expect(uploaded).toBeInstanceOf(File);
      expect(uploaded.name).toBe('avatar.png');
      expect(uploaded.type).toBe('image/png');
      expect(cmp.avatarCropOpen).toBeFalse();
      expect(cmp.avatarCropUrl).toBeNull();
      expect(revokeSpy).toHaveBeenCalledWith('blob:test');
    });

    it('falls back to a zoom of 1 when the zoom is not finite', async () => {
      spyOn(URL, 'revokeObjectURL');
      const drawSpy = spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
      const blob = new Blob(['img'], { type: 'image/png' });
      spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake(function (
        this: HTMLCanvasElement,
        cb: BlobCallback,
      ) {
        cb(blob);
      });
      primeReadyCrop('bad');

      await cmp.confirmAvatarCrop();

      // zoom falls back to 1 => crop = base/1 = 100, source offset (200-100)/2=50, (100-100)/2=0.
      expect(drawSpy).toHaveBeenCalledWith(
        jasmine.anything() as unknown as CanvasImageSource,
        50,
        0,
        100,
        100,
        0,
        0,
        512,
        512,
      );
      expect(account.uploadAvatar).toHaveBeenCalledTimes(1);
    });
  });

  describe('ngOnDestroy', () => {
    it('revokes any open object url and resets crop state', () => {
      const revokeSpy = spyOn(URL, 'revokeObjectURL');
      cmp.avatarCropOpen = true;
      cmp.avatarCropUrl = 'blob:test';
      cmp.ngOnDestroy();
      expect(cmp.avatarCropOpen).toBeFalse();
      expect(cmp.avatarCropUrl).toBeNull();
      expect(revokeSpy).toHaveBeenCalledWith('blob:test');
    });

    it('is a no-op revoke when no url is open', () => {
      const revokeSpy = spyOn(URL, 'revokeObjectURL');
      cmp.ngOnDestroy();
      expect(revokeSpy).not.toHaveBeenCalled();
    });
  });
});
