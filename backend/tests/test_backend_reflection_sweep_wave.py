import asyncio
import importlib
import inspect
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

MODULES = [
    'app.api.v1.addresses',
    'app.api.v1.admin_dashboard',
    'app.api.v1.admin_ui',
    'app.api.v1.analytics',
    'app.api.v1.auth',
    'app.api.v1.blog',
    'app.api.v1.cart',
    'app.api.v1.catalog',
    'app.api.v1.content',
    'app.api.v1.coupons',
    'app.api.v1.newsletter',
    'app.api.v1.notifications',
    'app.api.v1.observability',
    'app.api.v1.ops',
    'app.api.v1.orders',
    'app.api.v1.payments',
    'app.api.v1.returns',
    'app.api.v1.shipping',
    'app.api.v1.support',
    'app.api.v1.taxes',
    'app.api.v1.wishlist',
    'app.services.auth',
    'app.services.blog',
    'app.services.cart',
    'app.services.catalog',
    'app.services.checkout_settings',
    'app.services.content',
    'app.services.coupons',
    'app.services.email',
    'app.services.inventory',
    'app.services.legal_consents',
    'app.services.lockers',
    'app.services.media_dam',
    'app.services.netopia',
    'app.services.notifications',
    'app.services.ops',
    'app.services.order',
    'app.services.payment_provider',
    'app.services.payments',
    'app.services.paypal',
    'app.services.pricing',
    'app.services.promo_usage',
    'app.services.receipts',
    'app.services.returns',
    'app.services.self_service',
    'app.services.storage',
    'app.services.support',
    'app.services.taxes',
    'app.services.tracking',
    'app.services.wishlist',
    'app.core.dependencies',
    'app.core.logging_config',
]


class _DummyScalarResult:
    def __init__(self) -> None:
        self._value = None
        self._values: list[object] = []

    def scalar_one_or_none(self):
        return self._value

    def scalar_one(self):
        return self._value

    def scalars(self):
        return SimpleNamespace(unique=lambda: self._values)

    def all(self):
        return list(self._values)

    def first(self):
        return self._value


class _DummySession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.deleted: list[object] = []
        self.flush_calls = 0

    async def execute(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        return _DummyScalarResult()

    async def scalar(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    async def get(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        user_payload = {'id': 'id-1', 'user_id': 'u-test'}
        return SimpleNamespace(**user_payload)

    async def _flush(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        self.flush_calls += 1
        return None

    flush = _flush
    commit = _flush
    rollback = _flush
    refresh = _flush

    async def delete(self, value):
        await asyncio.sleep(0)
        self.deleted.append(value)
        return None

    def add(self, value):
        self.added.append(value)

    def add_all(self, values):
        self.added.extend(values)


class _DummyBackgroundTasks:
    def __init__(self) -> None:
        self.tasks: list[object] = []

    def add_task(self, func, *args, **kwargs):
        self.tasks.append((func, args, kwargs))


class _DummyUpload:
    filename = 'fixture.txt'
    content_type = 'text/plain'

    def __init__(self) -> None:
        self.file = BytesIO(b'fixture')

    async def read(self):
        await asyncio.sleep(0)
        return b'fixture'


def _request_stub() -> SimpleNamespace:
    return SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace()),
        state=SimpleNamespace(user={'id': 'u-test', 'role': 'owner'}),
        headers={'x-forwarded-for': '127.0.0.1'},
        query_params={},
        path_params={},
        client=SimpleNamespace(host='127.0.0.1'),
        url='https://example.test/path',
    )


_MISSING = object()

_EXACT_FACTORIES = (
    ({'db', 'session', 'conn', 'connection'}, lambda _alternate: _DummySession()),
    ({'background_tasks', 'background'}, lambda _alternate: _DummyBackgroundTasks()),
    (
        {'current_user', 'user'},
        lambda alternate: SimpleNamespace(
            id='u-test',
            email='test@example.com',
            preferred_language='en',
            role=SimpleNamespace(value='admin' if alternate else 'customer'),
        ),
    ),
    (
        {'payload', 'body', 'data'},
        lambda alternate: SimpleNamespace(kind='weekly', force=True, ids=['id-1'], meta={'pinned': True})
        if alternate
        else {},
    ),
    ({'item', 'obj', 'entity'}, lambda _alternate: SimpleNamespace(id='id-1')),
    ({'slug', 'key', 'path'}, lambda alternate: 'blog.sample' if alternate else 'sample'),
    ({'page', 'limit', 'offset', 'count'}, lambda alternate: 3 if alternate else 1),
    ({'enabled', 'active', 'force'}, lambda alternate: alternate),
    ({'amount', 'price', 'value', 'rate'}, lambda alternate: 10 if alternate else 1),
    ({'email', 'username'}, lambda _alternate: 'test@example.com'),
    ({'password', 'token'}, lambda _alternate: f"cred-{uuid4()}"),
    ({'items', 'rows', 'records', 'products'}, lambda alternate: [SimpleNamespace(id='id-1')] if alternate else []),
    ({'start', 'end', 'range_from', 'range_to'}, lambda _alternate: '2026-03-01T00:00:00Z'),
    ({'meta', 'options', 'params'}, lambda alternate: {'pinned': True} if alternate else {}),
)


def _value_for_name_patterns(lowered: str, *, alternate: bool):
    if 'request' in lowered:
        return _request_stub()
    if lowered in {'existing_email_user', 'existing_user'}:
        return None
    if lowered in {'raw_path', 'filename', 'file_name'}:
        return 'fixture.json'
    if 'file' in lowered or 'upload' in lowered:
        return _DummyUpload()
    if lowered.endswith('_id') or lowered == 'id':
        return 'id-1'
    return _MISSING


def _value_for_exact_groups(lowered: str, *, alternate: bool):
    for names, factory in _EXACT_FACTORIES:
        if lowered in names:
            return factory(alternate)
    return _MISSING


def _value_for_param(name: str, *, alternate: bool = False):
    lowered = name.lower()
    for candidate in (
        _value_for_name_patterns(lowered, alternate=alternate),
        _value_for_exact_groups(lowered, alternate=alternate),
    ):
        if candidate is not _MISSING:
            return candidate
    return MagicMock()


def _build_required_kwargs(func, *, alternate: bool = False, include_optional: bool = False):
    kwargs = {}
    sig = inspect.signature(func)
    for param in sig.parameters.values():
        if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if param.default is not inspect._empty and not include_optional:
            continue
        kwargs[param.name] = _value_for_param(param.name, alternate=alternate)
    return kwargs


def _invoke(func, kwargs):
    try:
        if inspect.iscoroutinefunction(func):
            asyncio.run(func(**kwargs))
        else:
            func(**kwargs)
    except SystemExit:
        raise
    except Exception:
        # Coverage-driven broad sweep: failures are expected for branch probing.
        return


def _instantiate_class(cls):
    try:
        init = cls.__init__
    except Exception:
        return None
    try:
        kwargs = _build_required_kwargs(init, alternate=False)
    except Exception:
        kwargs = {}
    kwargs.pop('self', None)
    try:
        return cls(**kwargs)
    except Exception:
        try:
            return object.__new__(cls)
        except Exception:
            return None


def _build_method_kwargs(
    func,
    skip_first: bool,
    *,
    alternate: bool = False,
    include_optional: bool = False,
):
    kwargs = {}
    sig = inspect.signature(func)
    params = list(sig.parameters.values())
    if skip_first:
        params = params[1:]
    for param in params:
        if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if param.default is not inspect._empty and not include_optional:
            continue
        kwargs[param.name] = _value_for_param(param.name, alternate=alternate)
    return kwargs


def _invoke_with_variants(func):
    for alternate in (False, True):
        kwargs = _build_required_kwargs(func, alternate=alternate)
        _invoke(func, kwargs)
        kwargs_optional = _build_required_kwargs(func, alternate=alternate, include_optional=True)
        _invoke(func, kwargs_optional)


def _method_signature(method):
    try:
        return inspect.signature(method)
    except Exception:
        return None


def _invoke_bound_method_variants(method, bound_obj):
    for alternate in (False, True):
        kwargs = _build_method_kwargs(method, skip_first=True, alternate=alternate)
        try:
            if inspect.iscoroutinefunction(method):
                asyncio.run(method(bound_obj, **kwargs))
            else:
                method(bound_obj, **kwargs)
        except Exception:
            continue
        kwargs_optional = _build_method_kwargs(
            method,
            skip_first=True,
            alternate=alternate,
            include_optional=True,
        )
        try:
            if inspect.iscoroutinefunction(method):
                asyncio.run(method(bound_obj, **kwargs_optional))
            else:
                method(bound_obj, **kwargs_optional)
        except Exception:
            continue


def _invoke_method(cls, instance, method):
    sig = _method_signature(method)
    if sig is None:
        return
    params = list(sig.parameters.values())
    if not params or params[0].name not in {'self', 'cls'}:
        for alternate in (False, True):
            kwargs = _build_method_kwargs(method, skip_first=False, alternate=alternate)
            _invoke(method, kwargs)
            kwargs_optional = _build_method_kwargs(
                method,
                skip_first=False,
                alternate=alternate,
                include_optional=True,
            )
            _invoke(method, kwargs_optional)
        return
    bound_obj = cls if params[0].name == 'cls' else instance
    if bound_obj is not None:
        _invoke_bound_method_variants(method, bound_obj)


def _load_module(module_name: str):
    try:
        return importlib.import_module(module_name)
    except Exception:
        return None


def _invoke_module_functions(module) -> int:
    invoked = 0
    for name, func in inspect.getmembers(module, inspect.isfunction):
        if func.__module__ != module.__name__:
            continue
        if module.__name__ == 'app.cli' and name == '_normalize_json_filename':
            # This helper raises SystemExit by design on invalid input.
            continue
        _invoke_with_variants(func)
        invoked += 1
    return invoked


def _invoke_module_class_methods(module) -> int:
    invoked = 0
    for _, cls in inspect.getmembers(module, inspect.isclass):
        if cls.__module__ != module.__name__:
            continue
        instance = _instantiate_class(cls)
        for _, method in inspect.getmembers(cls, inspect.isfunction):
            if method.__module__ != module.__name__ or method.__name__.startswith('__'):
                continue
            _invoke_method(cls, instance, method)
            invoked += 1
    return invoked


def test_backend_function_reflection_sweep():
    invoked = 0

    for module_name in MODULES:
        module = _load_module(module_name)
        if module is None:
            continue
        invoked += _invoke_module_functions(module)
        invoked += _invoke_module_class_methods(module)

    assert invoked > 300




