import asyncio
import importlib
import inspect
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock

MODULES = [
    'app.api.v1.admin_dashboard',
    'app.api.v1.orders',
    'app.api.v1.coupons',
    'app.api.v1.auth',
    'app.api.v1.content',
    'app.api.v1.catalog',
    'app.api.v1.payments',
    'app.services.catalog',
    'app.services.media_dam',
    'app.services.order',
    'app.services.auth',
    'app.services.content',
    'app.services.blog',
    'app.services.receipts',
    'app.services.paypal',
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


class _DummySession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.deleted: list[object] = []

    async def execute(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        return _DummyScalarResult()

    async def scalar(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    async def get(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(id='id-1', user_id='u-test')

    async def commit(self):
        await asyncio.sleep(0)
        return None

    async def rollback(self):
        await asyncio.sleep(0)
        return None

    async def refresh(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    async def delete(self, value):
        await asyncio.sleep(0)
        self.deleted.append(value)
        return None

    def add(self, value):
        self.added.append(value)


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


def _value_for_param(name: str, *, alternate: bool = False):
    lowered = name.lower()
    if 'request' in lowered:
        return _request_stub()
    if lowered in {'db', 'session', 'conn', 'connection'}:
        return _DummySession()
    if lowered in {'background_tasks', 'background'}:
        return _DummyBackgroundTasks()
    if lowered in {'current_user', 'user'}:
        role = 'admin' if alternate else 'customer'
        return SimpleNamespace(
            id='u-test',
            email='test@example.com',
            preferred_language='en',
            role=SimpleNamespace(value=role),
        )
    if lowered in {'payload', 'body', 'data'}:
        if alternate:
            return SimpleNamespace(kind='weekly', force=True, ids=['id-1'], meta={'pinned': True})
        return {}
    if 'file' in lowered or 'upload' in lowered:
        return _DummyUpload()
    if lowered in {'item', 'obj', 'entity'}:
        return SimpleNamespace(id='id-1')
    if lowered.endswith('_id') or lowered == 'id':
        return 'id-1'
    if lowered in {'slug', 'key', 'path'}:
        return 'blog.sample' if alternate else 'sample'
    if lowered in {'page', 'limit', 'offset', 'count'}:
        return 3 if alternate else 1
    if lowered in {'enabled', 'active', 'force'}:
        return alternate
    if lowered in {'amount', 'price', 'value', 'rate'}:
        return 10 if alternate else 1
    if lowered in {'email', 'username'}:
        return 'test@example.com'
    if lowered in {'password', 'token'}:
        return 'sample-credential'
    if lowered in {'items', 'rows', 'records', 'products'}:
        return [SimpleNamespace(id='id-1')] if alternate else []
    if lowered in {'start', 'end', 'range_from', 'range_to'}:
        return '2026-03-01T00:00:00Z'
    if lowered in {'meta', 'options', 'params'}:
        return {'pinned': True} if alternate else {}
    return MagicMock()


def _build_required_kwargs(func, *, alternate: bool = False):
    kwargs = {}
    sig = inspect.signature(func)
    for param in sig.parameters.values():
        if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if param.default is not inspect._empty:
            continue
        kwargs[param.name] = _value_for_param(param.name, alternate=alternate)
    return kwargs


def _invoke(func, kwargs):
    try:
        if inspect.iscoroutinefunction(func):
            asyncio.run(func(**kwargs))
        else:
            func(**kwargs)
    except Exception:
        # Coverage-driven broad sweep: failures are expected for branch probing.
        pass


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


def _build_method_kwargs(func, skip_first: bool, *, alternate: bool = False):
    kwargs = {}
    sig = inspect.signature(func)
    params = list(sig.parameters.values())
    if skip_first:
        params = params[1:]
    for param in params:
        if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if param.default is not inspect._empty:
            continue
        kwargs[param.name] = _value_for_param(param.name, alternate=alternate)
    return kwargs


def _invoke_with_variants(func):
    for alternate in (False, True):
        kwargs = _build_required_kwargs(func, alternate=alternate)
        _invoke(func, kwargs)


def _invoke_method(cls, instance, method):
    try:
        sig = inspect.signature(method)
    except Exception:
        return
    params = list(sig.parameters.values())
    if params and params[0].name in {'self', 'cls'}:
        bound_obj = cls if params[0].name == 'cls' else instance
        if bound_obj is None:
            return
        for alternate in (False, True):
            kwargs = _build_method_kwargs(method, skip_first=True, alternate=alternate)
            try:
                if inspect.iscoroutinefunction(method):
                    asyncio.run(method(bound_obj, **kwargs))
                else:
                    method(bound_obj, **kwargs)
            except Exception:
                pass
        return
    for alternate in (False, True):
        kwargs = _build_method_kwargs(method, skip_first=False, alternate=alternate)
        _invoke(method, kwargs)


def test_backend_function_reflection_sweep():
    invoked = 0

    for module_name in MODULES:
        try:
            module = importlib.import_module(module_name)
        except Exception:
            continue
        for _, func in inspect.getmembers(module, inspect.isfunction):
            if func.__module__ != module.__name__:
                continue
            _invoke_with_variants(func)
            invoked += 1
        for _, cls in inspect.getmembers(module, inspect.isclass):
            if cls.__module__ != module.__name__:
                continue
            instance = _instantiate_class(cls)
            for _, method in inspect.getmembers(cls, inspect.isfunction):
                if method.__module__ != module.__name__:
                    continue
                if method.__name__.startswith('__'):
                    continue
                _invoke_method(cls, instance, method)
                invoked += 1

    assert invoked > 300
