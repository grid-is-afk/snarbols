import { useState } from "react";
import { TYPE_PROVIDER } from "@/types";
import { AI_PROVIDERS } from "@/config";
import { useApp } from "@/contexts";
import {
  getCustomAiProviders,
  addCustomAiProvider,
  updateCustomAiProvider,
  removeCustomAiProvider,
  validateCurl,
} from "@/lib";

export function useCustomAiProviders() {
  const { loadData } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [formData, setFormData] = useState<TYPE_PROVIDER>({
    id: "",
    streaming: false,
    responseContentPath: "",
    isCustom: true,
    curl: "",
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleEdit = async (providerId: string) => {
    const customProviders = await getCustomAiProviders();
    const provider = customProviders.find((p) => p.id === providerId);
    if (!provider) return;

    setFormData({
      ...provider,
    });
    setEditingProvider(providerId);
    setShowForm(!showForm);
    setErrors({});
  };

  const handleAutoFill = (providerId: string) => {
    const provider = AI_PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return;

    setFormData({
      ...provider,
      curl: provider.curl,
    });

    setErrors({});
  };

  const handleDelete = (providerId: string) => {
    setDeleteConfirm(providerId);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;

    try {
      const success = await removeCustomAiProvider(deleteConfirm);
      if (success) {
        setDeleteConfirm(null);
        loadData(); // Refresh data
      }
    } catch (error) {
      console.error("Error deleting custom provider:", error);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirm(null);
  };

  const handleSave = async () => {
    // Validate form
    const newErrors: { [key: string]: string } = {};

    if (!formData.curl.trim()) {
      newErrors.curl = "Curl command is required";
    } else {
      const validation = validateCurl(formData.curl, ["TEXT"]);
      if (!validation.isValid) {
        newErrors.curl = validation.message || "";
      }
    }

    if (!formData.responseContentPath?.trim()) {
      newErrors.responseContentPath = "Response content path is required";
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      return;
    }

    try {
      if (editingProvider) {
        // Update existing provider
        const success = await updateCustomAiProvider(editingProvider, {
          curl: formData.curl,
          streaming: formData.streaming,
          responseContentPath: formData.responseContentPath,
        });

        if (success) {
          setEditingProvider(null);
          setShowForm(false);
          setFormData({
            id: "",
            streaming: false,
            responseContentPath: "",
            isCustom: true,
            curl: "",
          });
          loadData(); // Refresh data
        } else {
          // Persistence failed — keep the form open and tell the user their
          // key was NOT saved, rather than silently closing as if it worked.
          setErrors({
            submit:
              "Couldn't save this provider — your API key was not stored. Please try again.",
          });
        }
      } else {
        // Create new provider
        const newProvider = {
          curl: formData.curl,
          streaming: formData.streaming,
          responseContentPath: formData.responseContentPath,
        };

        const saved = await addCustomAiProvider(newProvider);
        if (saved) {
          setShowForm(false);
          setFormData({
            id: "",
            streaming: false,
            responseContentPath: "",
            isCustom: true,
            curl: "",
          });
          loadData(); // Refresh data
        } else {
          setErrors({
            submit:
              "Couldn't save this provider — your API key was not stored. Please try again.",
          });
        }
      }
    } catch (error) {
      // Log only the error name — the plaintext key must never reach the console.
      console.error(
        "Error saving custom provider:",
        error instanceof Error ? error.name : "unknown error"
      );
      setErrors({
        submit:
          "Something went wrong saving this provider — your API key was not stored. Please try again.",
      });
    }
  };

  return {
    errors,
    setErrors,
    showForm,
    setShowForm,
    editingProvider,
    setEditingProvider,
    deleteConfirm,
    formData,
    setFormData,
    handleSave,
    handleAutoFill,
    handleEdit,
    handleDelete,
    confirmDelete,
    cancelDelete,
  };
}
