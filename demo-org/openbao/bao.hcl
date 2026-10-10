# OpenBao: integrated (Raft) storage on one node, plain HTTP inside the
# network (Caddy terminates TLS for vault.<domain>).
# Data lives in /openbao/file: the image's entrypoint hands that folder to the
# openbao user. A new folder (such as /openbao/data) would be created owned
# by root, and OpenBao, which runs as openbao, could not write to it.
storage "raft" {
  path    = "/openbao/file"
  node_id = "planet-express-1"
}
listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = true
}
api_addr      = "http://openbao:8200"
cluster_addr  = "http://openbao:8201"
ui            = true
disable_mlock = true
