terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.13"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Local state by default. For a team, swap in:
  #   backend "azurerm" {
  #     resource_group_name  = "tfstate-rg"
  #     storage_account_name = "flipagenttfstate"
  #     container_name       = "tfstate"
  #     key                  = "flipagent.tfstate"
  #   }
}

provider "azurerm" {
  features {}
}

provider "azuread" {}
