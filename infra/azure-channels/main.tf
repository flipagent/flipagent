locals {
   prefix = "flipagent-channels-${var.environment}"
   tags = {
      project    = "flipagent"
      component  = "channels"
      environment = var.environment
      managed_by = "terraform"
   }
}

# --- Resource group ----------------------------------------------------------
# Separate RG so this module's lifecycle is independent of infra/azure. You
# can `terraform destroy` here without touching the prod api stack.

resource "azurerm_resource_group" "rg" {
   name     = local.prefix
   location = var.location
   tags     = local.tags
}

# --- Networking --------------------------------------------------------------

resource "azurerm_virtual_network" "vnet" {
   name                = "${local.prefix}-vnet"
   address_space       = ["10.50.0.0/16"]
   location            = azurerm_resource_group.rg.location
   resource_group_name = azurerm_resource_group.rg.name
   tags                = local.tags
}

resource "azurerm_subnet" "subnet" {
   name                 = "${local.prefix}-subnet"
   resource_group_name  = azurerm_resource_group.rg.name
   virtual_network_name = azurerm_virtual_network.vnet.name
   address_prefixes     = ["10.50.1.0/24"]
}

resource "azurerm_network_security_group" "nsg" {
   name                = "${local.prefix}-nsg"
   location            = azurerm_resource_group.rg.location
   resource_group_name = azurerm_resource_group.rg.name
   tags                = local.tags

   security_rule {
      name                       = "ssh"
      priority                   = 100
      direction                  = "Inbound"
      access                     = "Allow"
      protocol                   = "Tcp"
      source_port_range          = "*"
      destination_port_range     = "22"
      source_address_prefix      = var.ssh_source_cidr
      destination_address_prefix = "*"
   }
}

resource "azurerm_public_ip" "vm" {
   name                = "${local.prefix}-ip"
   resource_group_name = azurerm_resource_group.rg.name
   location            = azurerm_resource_group.rg.location
   # Static so the IP survives deallocate/start cycles — important since
   # SSH config + any Discord webhooks would otherwise need re-pointing.
   allocation_method = "Static"
   sku               = "Standard"
   tags              = local.tags
}

resource "azurerm_network_interface" "vm" {
   name                = "${local.prefix}-nic"
   location            = azurerm_resource_group.rg.location
   resource_group_name = azurerm_resource_group.rg.name
   tags                = local.tags

   ip_configuration {
      name                          = "ipconfig"
      subnet_id                     = azurerm_subnet.subnet.id
      private_ip_address_allocation = "Dynamic"
      public_ip_address_id          = azurerm_public_ip.vm.id
   }
}

resource "azurerm_network_interface_security_group_association" "vm" {
   network_interface_id      = azurerm_network_interface.vm.id
   network_security_group_id = azurerm_network_security_group.nsg.id
}

# --- VM ----------------------------------------------------------------------

resource "azurerm_linux_virtual_machine" "vm" {
   name                  = "${local.prefix}-vm"
   resource_group_name   = azurerm_resource_group.rg.name
   location              = azurerm_resource_group.rg.location
   size                  = var.vm_size
   admin_username        = var.admin_username
   network_interface_ids = [azurerm_network_interface.vm.id]
   tags                  = local.tags

   admin_ssh_key {
      username   = var.admin_username
      public_key = file(var.ssh_pubkey_path)
   }

   os_disk {
      caching              = "ReadWrite"
      storage_account_type = "StandardSSD_LRS"
      disk_size_gb         = var.os_disk_gb
   }

   source_image_reference {
      publisher = "Canonical"
      offer     = "ubuntu-24_04-lts"
      sku       = "server"
      version   = "latest"
   }

   custom_data = base64encode(templatefile("${path.module}/cloud-init.yaml", {
      admin_username   = var.admin_username
      flipagent_repo   = var.flipagent_repo
      flipagent_branch = var.flipagent_branch
   }))

   lifecycle {
      # custom_data is a one-shot bootstrap. Re-rendering on every apply
      # would force VM replacement and destroy ~/.claude login state and
      # the cloned repo. Edit cloud-init.yaml then run `make rebuild` if
      # you actually want to re-bootstrap.
      ignore_changes = [
         custom_data,
      ]
   }
}
