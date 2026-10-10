# OpenBao: integrated (Raft) storage on one node, plain HTTP inside the
# network (Caddy terminates TLS for vault.<domain>).
storage "raft" {
  path    = "/openbao/data"
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
