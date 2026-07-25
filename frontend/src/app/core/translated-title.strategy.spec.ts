import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot } from '@angular/router';
import { Subject } from 'rxjs';

import { TranslatedTitleStrategy } from './translated-title.strategy';

interface LangChangeEvent {
  readonly lang: string;
}

describe('TranslatedTitleStrategy', () => {
  let onLangChange$: Subject<LangChangeEvent>;
  let title: jasmine.SpyObj<Title>;
  let instant: jasmine.Spy<(key: string) => string>;

  function createStrategy(): TranslatedTitleStrategy {
    onLangChange$ = new Subject<LangChangeEvent>();
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    instant = jasmine.createSpy('instant');

    // Construct directly with controlled stubs so we can drive the
    // onLangChange observable and the `instant` translator precisely and
    // assert the subscription wiring set up in the constructor.
    return new TranslatedTitleStrategy(title, {
      onLangChange: onLangChange$.asObservable(),
      instant,
    } as never);
  }

  afterEach(() => {
    if (onLangChange$ && !onLangChange$.closed) {
      onLangChange$.complete();
    }
  });

  it('returns early without setting a title when there is no built title', () => {
    const strategy = createStrategy();
    spyOn(
      strategy as unknown as { buildTitle: () => string | undefined },
      'buildTitle',
    ).and.returnValue(undefined);

    strategy.updateTitle({} as RouterStateSnapshot);

    expect(instant).not.toHaveBeenCalled();
    expect(title.setTitle).not.toHaveBeenCalled();
  });

  it('sets the translated title when translation differs from the raw key', () => {
    const strategy = createStrategy();
    spyOn(
      strategy as unknown as { buildTitle: () => string | undefined },
      'buildTitle',
    ).and.returnValue('TITLE.HOME');
    instant.and.returnValue('Home');

    strategy.updateTitle({} as RouterStateSnapshot);

    expect(instant).toHaveBeenCalledWith('TITLE.HOME');
    expect(title.setTitle).toHaveBeenCalledOnceWith('Home');
  });

  it('falls back to the raw key when the translation equals the key (no translation found)', () => {
    const strategy = createStrategy();
    spyOn(
      strategy as unknown as { buildTitle: () => string | undefined },
      'buildTitle',
    ).and.returnValue('TITLE.HOME');
    instant.and.returnValue('TITLE.HOME');

    strategy.updateTitle({} as RouterStateSnapshot);

    expect(title.setTitle).toHaveBeenCalledOnceWith('TITLE.HOME');
  });

  it('falls back to the raw key when the translation is empty/falsy', () => {
    const strategy = createStrategy();
    spyOn(
      strategy as unknown as { buildTitle: () => string | undefined },
      'buildTitle',
    ).and.returnValue('TITLE.HOME');
    instant.and.returnValue('');

    strategy.updateTitle({} as RouterStateSnapshot);

    expect(title.setTitle).toHaveBeenCalledOnceWith('TITLE.HOME');
  });

  it('re-applies the last snapshot title when the language changes', () => {
    const strategy = createStrategy();
    spyOn(
      strategy as unknown as { buildTitle: () => string | undefined },
      'buildTitle',
    ).and.returnValue('TITLE.HOME');
    instant.and.returnValues('Home', 'Acasă');

    strategy.updateTitle({} as RouterStateSnapshot);
    expect(title.setTitle).toHaveBeenCalledOnceWith('Home');

    onLangChange$.next({ lang: 'ro' });

    expect(instant).toHaveBeenCalledTimes(2);
    expect(title.setTitle).toHaveBeenCalledTimes(2);
    expect(title.setTitle).toHaveBeenCalledWith('Acasă');
  });

  it('ignores language changes when no snapshot has been recorded yet', () => {
    createStrategy();

    onLangChange$.next({ lang: 'ro' });

    expect(instant).not.toHaveBeenCalled();
    expect(title.setTitle).not.toHaveBeenCalled();
  });
});
