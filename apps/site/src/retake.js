// retake-dev at build time, for the dock and runtime routes. It reads its
// runtime and dock from its own files, so it's loaded from node_modules as is:
// not bundled, and not traced into the deployment (those routes are built
// once, at build time, and never run on the server).
export const retakeDev = () => import(/* turbopackIgnore: true */ /* webpackIgnore: true */ "retake-dev")
