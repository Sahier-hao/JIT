"""Admin routes must declare the unified require_admin dependency."""
from test_artifacts import real_run  # noqa: F401
from test_catalog_api import settings  # noqa: F401


PUBLIC_ADMIN_PATHS = {
    '/api/admin/session',
    '/api/admin/setup',
    '/api/admin/login',
    '/api/admin/logout',
}


def _flatten(app):
    """Yield direct routes and routes inside FastAPI's lazy included routers."""
    for route in app.routes:
        if type(route).__name__ == '_IncludedRouter':
            yield from route.original_router.routes
        else:
            yield route


def test_every_admin_route_declares_require_admin(settings):  # noqa: F811
    from jit_baseline.api import create_app
    from jit_baseline.auth.dependencies import require_admin

    app = create_app(**settings)
    admin_routes = [route for route in _flatten(app)
                    if getattr(route, 'path', '').startswith('/api/admin')]
    assert admin_routes, '没有发现管理员路由'
    protected = [route for route in admin_routes if route.path not in PUBLIC_ADMIN_PATHS]
    assert protected, '没有发现受保护的管理员路由'
    for route in protected:
        calls = [dependency.call for dependency in route.dependant.dependencies]
        assert require_admin in calls, f'{route.path} 未声明 require_admin'


def test_admin_paths_are_not_authenticated_by_the_legacy_prefix_list():
    from jit_baseline.auth.admin import protected

    for path in ('/api/admin/datasets/example', '/api/admin/multi-project-reports',
                 '/api/admin/curation/preview', '/api/admin/evaluation-evidence'):
        assert protected(path) is False, f'{path} 仍依赖硬编码管理员白名单'
