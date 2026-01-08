import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Title,
  Text,
  Paper,
  Group,
  Avatar,
  Button,
  TextInput,
  Textarea,
  Stack,
  Loader,
  Center,
  rem,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { IconUpload, IconPhoto, IconX, IconArrowLeft, IconLock } from '@tabler/icons-react';
import dayjs from 'dayjs';

import { usersApi } from '../api/users';
import { useAuthStore } from '../store/authStore';
import type { User } from '../types';

export default function ProfileEditPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { updateUser } = useAuthStore();

  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    phone_number: '',
    bio: '',
    birthdate: null as Date | null,
    house: null as number | null,
  });

  const { data: user, isLoading } = useQuery({
    queryKey: ['user', 'me'],
    queryFn: usersApi.getCurrentUser,
  });

  useEffect(() => {
    if (user) {
      setFormData({
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        phone_number: user.phone_number || '',
        bio: user.bio || '',
        birthdate: user.birthdate ? new Date(user.birthdate) : null,
        house: user.house,
      });
    }
  }, [user]);

  const updateProfileMutation = useMutation({
    mutationFn: (data: Partial<User>) => usersApi.updateProfile(data),
    onSuccess: (updatedUser) => {
      updateUser(updatedUser);
      queryClient.invalidateQueries({ queryKey: ['user'] });
      notifications.show({
        title: 'Profile updated',
        message: 'Your profile has been successfully updated.',
        color: 'green',
      });
      navigate('/profil');
    },
    onError: () => {
      notifications.show({
        title: 'Error',
        message: 'Failed to update profile. Please try again.',
        color: 'red',
      });
    },
  });

  const uploadPictureMutation = useMutation({
    mutationFn: (file: File) => usersApi.updateProfilePicture(file),
    onSuccess: (updatedUser) => {
      updateUser(updatedUser);
      queryClient.invalidateQueries({ queryKey: ['user'] });
      notifications.show({
        title: 'Picture updated',
        message: 'Your profile picture has been updated.',
        color: 'green',
      });
    },
    onError: () => {
      notifications.show({
        title: 'Error',
        message: 'Failed to upload picture. Please try again.',
        color: 'red',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfileMutation.mutate({
      first_name: formData.first_name,
      last_name: formData.last_name,
      phone_number: formData.phone_number,
      bio: formData.bio,
      birthdate: formData.birthdate
        ? dayjs(formData.birthdate).format('YYYY-MM-DD')
        : null,
      house: formData.house,
    });
  };

  const handleDrop = (files: File[]) => {
    if (files.length > 0) {
      uploadPictureMutation.mutate(files[0]);
    }
  };

  if (isLoading) {
    return (
      <Center h={200}>
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <>
      <Button
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        onClick={() => navigate('/profil')}
        mb="md"
      >
        Back to Profile
      </Button>

      <Title order={1} mb="xl">
        Edit Profile
      </Title>

      <Paper withBorder p="xl" radius="md" mb="xl">
        <Title order={4} mb="md">
          Profile Picture
        </Title>

        <Group>
          <Avatar
            src={user?.profile_picture}
            size={100}
            radius={100}
          >
            {user?.first_name?.[0]}
            {user?.last_name?.[0]}
          </Avatar>

          <Dropzone
            onDrop={handleDrop}
            accept={IMAGE_MIME_TYPE}
            maxSize={5 * 1024 ** 2}
            loading={uploadPictureMutation.isPending}
            style={{ flex: 1 }}
          >
            <Group
              justify="center"
              gap="xl"
              mih={100}
              style={{ pointerEvents: 'none' }}
            >
              <Dropzone.Accept>
                <IconUpload
                  style={{
                    width: rem(52),
                    height: rem(52),
                    color: 'var(--mantine-color-blue-6)',
                  }}
                  stroke={1.5}
                />
              </Dropzone.Accept>
              <Dropzone.Reject>
                <IconX
                  style={{
                    width: rem(52),
                    height: rem(52),
                    color: 'var(--mantine-color-red-6)',
                  }}
                  stroke={1.5}
                />
              </Dropzone.Reject>
              <Dropzone.Idle>
                <IconPhoto
                  style={{
                    width: rem(52),
                    height: rem(52),
                    color: 'var(--mantine-color-dimmed)',
                  }}
                  stroke={1.5}
                />
              </Dropzone.Idle>

              <div>
                <Text size="lg" inline>
                  Drag image here or click to select
                </Text>
                <Text size="sm" c="dimmed" inline mt={7}>
                  Max file size: 5MB
                </Text>
              </div>
            </Group>
          </Dropzone>
        </Group>
      </Paper>

      <Paper withBorder p="xl" radius="md">
        <form onSubmit={handleSubmit}>
          <Stack>
            <Title order={4}>Personal Information</Title>

            <Group grow>
              <TextInput
                label="First Name"
                value={formData.first_name}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    first_name: e.target.value,
                  }))
                }
                required
              />
              <TextInput
                label="Last Name"
                value={formData.last_name}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    last_name: e.target.value,
                  }))
                }
                required
              />
            </Group>

            <TextInput
              label="Phone Number"
              placeholder="+45 12 34 56 78"
              value={formData.phone_number}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  phone_number: e.target.value,
                }))
              }
            />

            <DateInput
              label="Birthday"
              placeholder="Select your birthday"
              value={formData.birthdate}
              onChange={(value) => {
                const date = value ? new Date(value) : null;
                setFormData((prev) => ({ ...prev, birthdate: date }));
              }}
              maxDate={new Date()}
              clearable
            />

            <Textarea
              label="Bio"
              placeholder="Tell us about yourself..."
              value={formData.bio}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, bio: e.target.value }))
              }
              minRows={3}
              maxLength={500}
              description={`${formData.bio.length}/500 characters`}
            />

            <Group justify="flex-end" mt="md">
              <Button variant="light" onClick={() => navigate('/profil')}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={updateProfileMutation.isPending}
              >
                Save Changes
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      <Paper withBorder p="xl" radius="md" mt="xl">
        <Title order={4} mb="md">
          Sikkerhed
        </Title>
        <Button
          variant="light"
          leftSection={<IconLock size={16} />}
          onClick={() => navigate('/profil/skift-adgangskode')}
        >
          Skift adgangskode
        </Button>
      </Paper>
    </>
  );
}
