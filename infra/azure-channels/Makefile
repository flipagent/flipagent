# flipagent-channels — convenience wrapper around terraform + az CLI.
#
# Lifecycle:
#   make apply         # provision (or update) the VM. First apply runs cloud-init.
#   make up            # az vm start — boots the deallocated VM. ~$1/day while on.
#   make down          # az vm deallocate — stops compute billing. ~$3/mo disk only.
#   make ssh           # ssh in as the admin user.
#   make logs          # tail the systemd unit log.
#   make status        # vm power state + systemd unit status.
#   make rebuild       # taint + reapply VM. Wipes ~/.claude + repo state.
#   make destroy       # terraform destroy — full teardown.
#
# Reads RG / VM name from terraform output, so they stay in sync with state.

SHELL := /usr/bin/env bash
.ONESHELL:
.SHELLFLAGS := -euo pipefail -c

RG := $(shell terraform output -raw resource_group 2>/dev/null)
VM := $(shell terraform output -raw vm_name 2>/dev/null)

.PHONY: init apply up down ssh logs status rebuild destroy

init:
	terraform init

apply:
	terraform apply

up:
	@if [ -z "$(VM)" ]; then echo "no VM in state — run 'make apply' first"; exit 1; fi
	az vm start --resource-group "$(RG)" --name "$(VM)"
	@echo "VM running. Public IP: $$(terraform output -raw public_ip)"

down:
	@if [ -z "$(VM)" ]; then echo "no VM in state — run 'make apply' first"; exit 1; fi
	az vm deallocate --resource-group "$(RG)" --name "$(VM)"
	@echo "VM deallocated. You're now paying disk ($$3/mo) only."

status:
	@if [ -z "$(VM)" ]; then echo "no VM in state"; exit 1; fi
	@echo "=== Power state ==="
	az vm get-instance-view --resource-group "$(RG)" --name "$(VM)" \
	   --query "instanceView.statuses[?starts_with(code, 'PowerState/')].displayStatus" -o tsv
	@echo "=== systemd unit (if reachable) ==="
	-ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new \
	   $$(terraform output -raw ssh_command | awk '{print $$2}') \
	   'systemctl status flipagent-channels --no-pager -l 2>&1 | head -30'

ssh:
	@$$(terraform output -raw ssh_command)

logs:
	@ssh -o StrictHostKeyChecking=accept-new \
	   $$(terraform output -raw ssh_command | awk '{print $$2}') \
	   'sudo journalctl -u flipagent-channels -f --no-pager'

rebuild:
	@echo "WARNING: this destroys ~/.claude state and re-runs cloud-init."
	@read -p "Continue? [y/N] " ans && [ "$$ans" = y ] || exit 1
	terraform taint azurerm_linux_virtual_machine.vm
	terraform apply

destroy:
	terraform destroy
