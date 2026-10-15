"""
PythonAnywhere WSGI entrypoint for HDSAT.

In PythonAnywhere -> Web -> WSGI configuration file, point to this module:

    import sys
    project_home = '/home/HDSAT/HDSAT'
    if project_home not in sys.path:
        sys.path.insert(0, project_home)
    from wsgi import application
"""

from backend.app import app as application  # noqa: F401
