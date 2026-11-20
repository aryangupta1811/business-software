# Builds the two images at the same time, under the names compose.yaml uses (stage 6). Used
# by .github/actions/smoke, which CI's smoke job and the images workflow share:
#   ARCH=amd64 docker buildx bake --load
# ARCH (amd64 or arm64) picks the platform and the build cache; the GITHUB_* variables come
# from the runner's environment and only label the images.

variable "ARCH" {
  default = "amd64"
}

variable "GITHUB_SERVER_URL" {
  default = "https://github.com"
}

variable "GITHUB_REPOSITORY" {
  default = "aryangupta1811/business-software"
}

variable "GITHUB_SHA" {
  default = ""
}

group "default" {
  targets = ["app", "web"]
}

target "_common" {
  context   = "."
  platforms = ["linux/${ARCH}"]
  labels = {
    "org.opencontainers.image.source"   = "${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}"
    "org.opencontainers.image.revision" = GITHUB_SHA
  }
}

# api, worker and migrate (ADR 0020).
target "app" {
  inherits   = ["_common"]
  dockerfile = "apps/api/Dockerfile"
  tags       = ["business-software-app:local"]
  cache-from = ["type=gha,scope=app-${ARCH}"]
  cache-to   = ["type=gha,mode=max,scope=app-${ARCH}"]
}

target "web" {
  inherits   = ["_common"]
  dockerfile = "apps/web/Dockerfile"
  tags       = ["business-software-web:local"]
  cache-from = ["type=gha,scope=web-${ARCH}"]
  cache-to   = ["type=gha,mode=max,scope=web-${ARCH}"]
}
