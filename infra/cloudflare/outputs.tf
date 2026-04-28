output "api_record" {
  value = "${cloudflare_record.api_cname.name}.flipagent.dev → ${cloudflare_record.api_cname.content}"
}

output "asuid_record" {
  value = "${cloudflare_record.api_asuid.name}.flipagent.dev → ${cloudflare_record.api_asuid.content}"
}
