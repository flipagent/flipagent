variable "environment" {
   description = "Environment slug — folded into resource names. Keep short; this module's RG is `flipagent-channels-<env>` so multiple sessions can coexist."
   type        = string
   default     = "main"
   validation {
      condition     = can(regex("^[a-z0-9]{1,12}$", var.environment))
      error_message = "environment must be lowercase alphanumeric, ≤12 chars."
   }
}

variable "location" {
   description = "Azure region. Defaults to eastus2 to match infra/azure (so VM and api share latency profile)."
   type        = string
   default     = "eastus2"
}

variable "vm_size" {
   description = "VM SKU. B2s (2 vCPU / 4 GiB / ~$1/day on, ~$3/mo deallocated) is enough for Claude Code + a Node build. Bump to B2ms if you want headroom for heavy tool use."
   type        = string
   default     = "Standard_B2s"
}

variable "os_disk_gb" {
   description = "OS disk size in GB. Holds the cloned repo, npm cache, ~/.claude state across deallocate/start cycles. 64 leaves room; bump if you cache big artifacts."
   type        = number
   default     = 64
}

variable "ssh_pubkey_path" {
   description = "Absolute path to your SSH public key. Pasted as the only authorized key on the VM."
   type        = string
}

variable "ssh_source_cidr" {
   description = "CIDR allowed to reach port 22. Default 0.0.0.0/0 is OPEN — set this to your IP/32 (or your VPN range) in tfvars before `terraform apply`."
   type        = string
   default     = "0.0.0.0/0"
}

variable "admin_username" {
   description = "Linux user the VM is created under. Repo lands at /home/<admin_username>/flipagent."
   type        = string
   default     = "flipagent"
}

variable "flipagent_repo" {
   description = "git URL the VM clones on first boot. Defaults to public GitHub mirror; swap to a deploy-key-authed SSH URL if you want a private branch."
   type        = string
   default     = "https://github.com/flipagent/flipagent.git"
}

variable "flipagent_branch" {
   description = "Branch to check out after clone. The bootstrap re-pulls this on `make rebuild`, so leave it on a stable branch."
   type        = string
   default     = "main"
}
