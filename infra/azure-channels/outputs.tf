output "resource_group" {
   value = azurerm_resource_group.rg.name
}

output "vm_name" {
   value = azurerm_linux_virtual_machine.vm.name
}

output "public_ip" {
   description = "Static public IP — survives deallocate/start cycles."
   value       = azurerm_public_ip.vm.ip_address
}

output "ssh_command" {
   description = "Copy-pasteable SSH command. Assumes your private key matches ssh_pubkey_path."
   value       = "ssh ${var.admin_username}@${azurerm_public_ip.vm.ip_address}"
}
