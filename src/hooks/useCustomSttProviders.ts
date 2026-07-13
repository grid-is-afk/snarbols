import { useState } from "react";
import { TYPE_PROVIDER } from "@/types";
import { SPEECH_TO_TEXT_PROVIDERS } from "@/config";
import { useApp } from "@/contexts";
import {
  addCustomSttProvider,
  getCustomSttProviders,
  removeCustomSttProvider,
  updateCustomSttProvider,
  validateCurl,
} from "@/lib";

export function useCustomSttProviders() {
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
    const customProviders = await getCustomSttProviders();
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
    const provider = SPEECH_TO_TEXT_PROVIDERS.find((p) => p.id === providerId);
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
      const success = await removeCustomSttProvider(deleteConfirm);
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
      const hasAudioVar = formData.curl.includes("{{AUDIO}}");

      if (!hasAudioVar) {
        newErrors.curl = "cURL command must contain {{AUDIO}}.";
      } else {
        const validation = validateCurl(formData.curl, []);
        if (!validation.isValid) {
          newErrors.curl = validation.message || "";
        }
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
        const success = await updateCustomSttProvider(editingProvider, {
          curl: formData.curl,
          streaming: false, // Streaming is not supported for STT providers. it will be fixed in the future.
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
          streaming: false, // Streaming is not supported for STT providers. it will be fixed in the future.
          responseContentPath: formData.responseContentPath,
        };

        const saved = await addCustomSttProvider(newProvider);
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
